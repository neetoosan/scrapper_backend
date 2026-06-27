"""
FastAPI application — REST API for the Edge Contact Scraper backend.

Endpoints:
  POST   /api/scrape              — Start a new scrape job
  GET    /api/scrape/{job_id}     — Get job status and results
  GET    /api/scrape/{job_id}/export — Download XLSX export
  DELETE /api/scrape/{job_id}     — Cancel/delete a job
  GET    /api/jobs                — List all jobs
  GET    /health                  — Health check
"""

import os
import sys
import logging
import re

# Add the backend directory to the Python path so Scrapy can find modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import io

from config import settings
from runner import scrape_runner
from export import build_workbook

# ── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
)
logger = logging.getLogger('edgewebscraper')

# ── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title='Edge Contact Scraper API',
    description=(
        'Server-side web scraping API powered by Scrapy. '
        'Extracts contact information (names, phones, emails, social handles, addresses) '
        'from websites, marketplaces, and search engines.'
    ),
    version='1.0.0',
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ── Health Check ────────────────────────────────────────────────────────────

@app.get('/health')
def health_check():
    """Health check endpoint."""
    return {
        'status': 'ok',
        'version': '1.0.0',
        'active_jobs': scrape_runner.active_job_count,
    }


# ── Start Scrape ────────────────────────────────────────────────────────────

@app.post('/api/scrape')
def start_scrape(request: dict):
    """
    Start a new scrape job.

    Body:
        url (str): URL to scrape (required)
        mode (str): "single" | "crawl" | "marketplace" (default: "single")
        max_pages (int): Maximum pages to crawl (default: 12)
        spider (str | null): Force specific spider, or auto-detect from URL
    """
    url = request.get('url', '').strip()
    if not url:
        raise HTTPException(status_code=400, detail='URL is required')

    # Basic URL validation
    if not re.match(r'^https?://', url, re.IGNORECASE):
        url = 'https://' + url

    mode = request.get('mode', 'single')
    if mode not in ('single', 'crawl', 'marketplace'):
        raise HTTPException(status_code=400, detail='Mode must be: single, crawl, or marketplace')

    max_pages = int(request.get('max_pages', 12))
    if max_pages < 1 or max_pages > 100:
        raise HTTPException(status_code=400, detail='max_pages must be between 1 and 100')

    spider = request.get('spider')

    # Check concurrent job limit
    if scrape_runner.active_job_count >= settings.MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f'Too many active jobs. Maximum: {settings.MAX_CONCURRENT_JOBS}',
        )

    try:
        job_id = scrape_runner.submit_job(
            url=url,
            mode=mode,
            max_pages=max_pages,
            spider_name=spider,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    logger.info(f'Job {job_id} submitted: {url} (mode={mode})')

    return {
        'job_id': job_id,
        'status': 'submitted',
        'url': url,
        'mode': mode,
    }


# ── Get Job Status ──────────────────────────────────────────────────────────

@app.get('/api/scrape/{job_id}')
def get_job_status(job_id: str):
    """Get the status and results of a scrape job."""
    job = scrape_runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f'Job {job_id} not found')
    return job


# ── Export XLSX ──────────────────────────────────────────────────────────────

@app.get('/api/scrape/{job_id}/export')
def export_xlsx(job_id: str):
    """Download XLSX export of job results."""
    job = scrape_runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f'Job {job_id} not found')

    if job['status'] != 'completed':
        raise HTTPException(
            status_code=400,
            detail=f'Job is not completed (status: {job["status"]})',
        )

    listings = job.get('listings', [])
    if not listings:
        raise HTTPException(status_code=404, detail='No results to export')

    # Build workbook
    xlsx_bytes = build_workbook(
        listings=listings,
        page_title=job.get('url', 'Scraped Data'),
        page_url=job.get('url', ''),
    )

    # Sanitize filename
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '-', job.get('url', 'export'))
    safe_name = re.sub(r'\s+', '-', safe_name)[:60]

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'Content-Disposition': f'attachment; filename="{safe_name}-contacts.xlsx"',
        },
    )


# ── Delete / Cancel Job ─────────────────────────────────────────────────────

@app.delete('/api/scrape/{job_id}')
def delete_job(job_id: str):
    """Cancel a running job or delete a completed one."""
    # Try to cancel first
    cancelled = scrape_runner.cancel_job(job_id)
    if cancelled:
        return {'job_id': job_id, 'status': 'cancelled'}

    # Try to delete
    deleted = scrape_runner.delete_job(job_id)
    if deleted:
        return {'job_id': job_id, 'status': 'deleted'}

    raise HTTPException(status_code=404, detail=f'Job {job_id} not found')


# ── List All Jobs ───────────────────────────────────────────────────────────

@app.get('/api/jobs')
def list_jobs():
    """List all scrape jobs."""
    return {
        'jobs': scrape_runner.list_jobs(),
        'active_count': scrape_runner.active_job_count,
    }


# ── Run with uvicorn ────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'main:app',
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True,
    )
