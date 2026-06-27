"""
Pydantic models for API request/response schemas.
"""

from datetime import datetime
from pydantic import BaseModel, Field, HttpUrl


# ── Request Models ──────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    """Request body for starting a new scrape job."""
    url: str = Field(..., description='URL to scrape')
    mode: str = Field(
        default='single',
        description='Scrape mode: "single" (one page), "crawl" (multi-page), "marketplace" (listing site)',
    )
    max_pages: int = Field(default=12, ge=1, le=100, description='Maximum pages to crawl')
    spider: str | None = Field(
        default=None,
        description='Force a specific spider. Auto-detected from URL if None.',
    )


# ── Response Models ─────────────────────────────────────────────────────────

class ContactResult(BaseModel):
    """A single extracted contact/business listing."""
    name: str = ''
    company_name: str = ''
    phone_numbers: list[str] = Field(default_factory=list)
    whatsapp_numbers: list[str] = Field(default_factory=list)
    social_media_handles: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)
    website: str = ''
    address: str = ''
    category: str = ''
    rating: str = ''
    review_count: str = ''
    source_url: str = ''
    page_title: str = ''


class ScrapeResult(BaseModel):
    """Full result of a scrape job."""
    page_title: str = ''
    page_url: str = ''
    total_listings: int = 0
    listings: list[ContactResult] = Field(default_factory=list)
    pages_scraped: int = 0
    failed_pages: list[str] = Field(default_factory=list)


class JobStatus(BaseModel):
    """Status of a scrape job."""
    job_id: str
    status: str = Field(
        description='Job status: pending, running, completed, failed, cancelled'
    )
    url: str
    mode: str
    started_at: datetime
    completed_at: datetime | None = None
    progress: str = ''
    results: ScrapeResult | None = None
    error: str | None = None


class JobSummary(BaseModel):
    """Brief summary of a job for the job list endpoint."""
    job_id: str
    status: str
    url: str
    mode: str
    started_at: datetime
    completed_at: datetime | None = None
    total_listings: int = 0


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = 'ok'
    version: str = '1.0.0'
    active_jobs: int = 0
