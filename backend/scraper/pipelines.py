"""
Scrapy Item Pipelines for cleaning, deduplication, and storage.
"""

import re
import logging
from utils import normalize_phone, unique_matches

logger = logging.getLogger(__name__)


class CleaningPipeline:
    """
    Cleans and normalizes scraped contact data.
    - Normalizes phone numbers
    - Validates email formats
    - Strips whitespace from all fields
    - Removes empty/invalid entries
    """

    EMAIL_RE = re.compile(r'^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$', re.IGNORECASE)

    def process_item(self, item, spider):
        # Clean string fields
        for field in ('name', 'company_name', 'website', 'address', 'category',
                      'rating', 'review_count', 'source_url', 'page_title'):
            if field in item and item[field]:
                item[field] = str(item[field]).strip()
            elif field in item:
                item[field] = ''

        # Normalize phone numbers
        if 'phone_numbers' in item:
            phones = item['phone_numbers'] or []
            item['phone_numbers'] = [p for p in (normalize_phone(p) for p in phones) if p]

        if 'whatsapp_numbers' in item:
            whatsapp = item['whatsapp_numbers'] or []
            item['whatsapp_numbers'] = [p for p in (normalize_phone(p) for p in whatsapp) if p]

        # Validate emails
        if 'emails' in item:
            emails = item['emails'] or []
            item['emails'] = [
                e.strip() for e in emails
                if e and self.EMAIL_RE.match(e.strip())
            ]

        # Clean social handles
        if 'social_media_handles' in item:
            handles = item['social_media_handles'] or []
            item['social_media_handles'] = [h.strip() for h in handles if h and h.strip()]

        return item


class DeduplicationPipeline:
    """
    Deduplicates items based on (source_url, name) key.
    Merges contact data from duplicate entries.
    """

    def __init__(self):
        self.seen = {}

    def open_spider(self, spider):
        self.seen = {}

    def process_item(self, item, spider):
        key = f"{item.get('source_url', '')}|{item.get('company_name', '')}|{item.get('name', '')}"

        if key in self.seen:
            existing = self.seen[key]
            # Merge arrays
            for field in ('phone_numbers', 'whatsapp_numbers', 'social_media_handles', 'emails'):
                existing_vals = existing.get(field, [])
                new_vals = item.get(field, [])
                existing[field] = unique_matches([*existing_vals, *new_vals])
            # Merge scalars (keep first non-empty)
            for field in ('website', 'address', 'category', 'rating', 'review_count'):
                if not existing.get(field) and item.get(field):
                    existing[field] = item[field]
            # Return the existing item (updated in place)
            from scrapy.exceptions import DropItem
            raise DropItem(f'Duplicate item merged: {key[:80]}')

        self.seen[key] = item
        return item

    def close_spider(self, spider):
        self.seen = {}


class StoragePipeline:
    """
    Stores scraped items in a thread-safe dict keyed by job_id.
    The runner.py module reads from this storage to return results via the API.
    """

    # Class-level storage shared across all spiders
    _storage: dict[str, list[dict]] = {}

    def open_spider(self, spider):
        job_id = getattr(spider, 'job_id', None) or 'default'
        if job_id not in self._storage:
            self._storage[job_id] = []
        logger.info(f'StoragePipeline opened for job: {job_id}')

    def process_item(self, item, spider):
        job_id = getattr(spider, 'job_id', None) or 'default'
        # Convert Scrapy Item to plain dict
        self._storage.setdefault(job_id, []).append(dict(item))
        return item

    def close_spider(self, spider):
        job_id = getattr(spider, 'job_id', None) or 'default'
        count = len(self._storage.get(job_id, []))
        logger.info(f'StoragePipeline closed for job {job_id}: {count} items stored')

    @classmethod
    def get_results(cls, job_id: str) -> list[dict]:
        """Retrieve stored results for a job."""
        return cls._storage.get(job_id, [])

    @classmethod
    def clear_results(cls, job_id: str):
        """Clear stored results for a job."""
        cls._storage.pop(job_id, None)

    @classmethod
    def get_all_job_ids(cls) -> list[str]:
        """List all job IDs with stored results."""
        return list(cls._storage.keys())
