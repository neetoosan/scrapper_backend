"""
CrawlerRunner integration — bridges Scrapy (Twisted) with FastAPI (asyncio).

Uses crochet to run Twisted's reactor in a background thread,
allowing Scrapy spiders to be triggered from async FastAPI endpoints.
"""

import re
import uuid
import logging
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse

import crochet
crochet.setup()  # Start Twisted reactor in a background thread

from scrapy.crawler import CrawlerRunner
from scrapy.utils.project import get_project_settings

from scraper.pipelines import StoragePipeline
from scraper.spiders.generic import GenericContactSpider
from scraper.spiders.yelp import YelpSpider
from scraper.spiders.jiji import JijiSpider
from scraper.spiders.yellowpages import YellowPagesSpider
from scraper.spiders.facebook import FacebookSpider
from scraper.spiders.google_search import GoogleSearchSpider, BingSearchSpider

logger = logging.getLogger(__name__)


# ── Spider Registry ─────────────────────────────────────────────────────────

SPIDER_MAP = {
    'generic': GenericContactSpider,
    'yelp': YelpSpider,
    'jiji': JijiSpider,
    'yellowpages': YellowPagesSpider,
    'facebook': FacebookSpider,
    'google_search': GoogleSearchSpider,
    'bing_search': BingSearchSpider,
}

# URL pattern → spider name
URL_PATTERNS = [
    (re.compile(r'yelp\.com', re.IGNORECASE), 'yelp'),
    (re.compile(r'jiji\.(?:ng|com\.gh|co\.ke|ug|co\.tz|et|com\.eg|sn)', re.IGNORECASE), 'jiji'),
    (re.compile(r'yellowpages\.com|yp\.com', re.IGNORECASE), 'yellowpages'),
    (re.compile(r'facebook\.com', re.IGNORECASE), 'facebook'),
    (re.compile(r'google\.[a-z.]+/search', re.IGNORECASE), 'google_search'),
    (re.compile(r'bing\.com/search', re.IGNORECASE), 'bing_search'),
]


def detect_spider(url: str) -> str:
    """Auto-detect the best spider for a given URL."""
    for pattern, spider_name in URL_PATTERNS:
        if pattern.search(url):
            return spider_name
    return 'generic'


# ── Job State ───────────────────────────────────────────────────────────────

class JobState:
    """Tracks the state of a scrape job."""

    def __init__(self, job_id: str, url: str, mode: str):
        self.job_id = job_id
        self.url = url
        self.mode = mode
        self.status = 'pending'  # pending, running, completed, failed, cancelled
        self.started_at = datetime.now(timezone.utc)
        self.completed_at = None
        self.progress = ''
        self.error = None
        self.spider_name = ''

    def to_dict(self) -> dict:
        results = StoragePipeline.get_results(self.job_id)
        return {
            'job_id': self.job_id,
            'status': self.status,
            'url': self.url,
            'mode': self.mode,
            'spider_name': self.spider_name,
            'started_at': self.started_at.isoformat(),
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'progress': self.progress,
            'error': self.error,
            'total_listings': len(results),
            'listings': results,
        }


# ── Scrape Runner ───────────────────────────────────────────────────────────

class ScrapeRunner:
    """
    Manages Scrapy spider execution within the FastAPI application lifecycle.
    Uses crochet to bridge Twisted and asyncio.
    """

    def __init__(self):
        self._jobs: dict[str, JobState] = {}
        settings = get_project_settings()
        settings.set('TWISTED_REACTOR', None, priority='cmdline')
        self._runner = CrawlerRunner(settings)

    def submit_job(self, url: str, mode: str = 'single',
                   max_pages: int = 12, spider_name: str | None = None) -> str:
        """
        Submit a new scrape job. Returns the job_id.
        """
        job_id = str(uuid.uuid4())[:8]

        # Auto-detect spider if not specified
        if not spider_name:
            spider_name = detect_spider(url)

        spider_cls = SPIDER_MAP.get(spider_name)
        if not spider_cls:
            raise ValueError(f'Unknown spider: {spider_name}')

        job = JobState(job_id=job_id, url=url, mode=mode)
        job.spider_name = spider_name

        with self._lock:
            self._jobs[job_id] = job

        # Launch the crawl in the Twisted reactor thread
        self._run_spider(job_id, spider_cls, url, mode, max_pages)

        return job_id

    @crochet.run_in_reactor
    def _run_spider(self, job_id: str, spider_cls, url: str, mode: str, max_pages: int):
        """Run a spider in the Twisted reactor thread via crochet."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = 'running'
                job.progress = 'Starting spider...'

        deferred = self._runner.crawl(
            spider_cls,
            url=url,
            mode=mode,
            max_pages=max_pages,
            job_id=job_id,
        )

        def on_success(_):
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.status = 'completed'
                    job.completed_at = datetime.now(timezone.utc)
                    results = StoragePipeline.get_results(job_id)
                    job.progress = f'Completed: {len(results)} listings found'
                    logger.info(f'Job {job_id} completed: {len(results)} items')

        def on_error(failure):
            with self._lock:
                job = self._jobs.get(job_id)
                if job:
                    job.status = 'failed'
                    job.completed_at = datetime.now(timezone.utc)
                    job.error = str(failure.value) if failure.value else str(failure)
                    logger.error(f'Job {job_id} failed: {job.error}')

        deferred.addCallback(on_success)
        deferred.addErrback(on_error)

        return deferred

    def get_job(self, job_id: str) -> dict | None:
        """Get job status and results."""
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            return None
        return job.to_dict()

    def list_jobs(self) -> list[dict]:
        """List all jobs with summary info."""
        with self._lock:
            jobs = list(self._jobs.values())
        return [
            {
                'job_id': j.job_id,
                'status': j.status,
                'url': j.url,
                'mode': j.mode,
                'spider_name': j.spider_name,
                'started_at': j.started_at.isoformat(),
                'completed_at': j.completed_at.isoformat() if j.completed_at else None,
                'total_listings': len(StoragePipeline.get_results(j.job_id)),
            }
            for j in jobs
        ]

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a running job (best-effort)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            if job.status in ('completed', 'failed', 'cancelled'):
                return False
            job.status = 'cancelled'
            job.completed_at = datetime.now(timezone.utc)
            job.error = 'Cancelled by user'
        return True

    def delete_job(self, job_id: str) -> bool:
        """Delete a job and its results."""
        with self._lock:
            if job_id not in self._jobs:
                return False
            del self._jobs[job_id]
        StoragePipeline.clear_results(job_id)
        return True

    @property
    def active_job_count(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.status == 'running')


# Singleton instance
scrape_runner = ScrapeRunner()
