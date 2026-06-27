"""
Custom Scrapy middlewares.
"""

import logging
from scrapy import signals

logger = logging.getLogger(__name__)


class LoggingMiddleware:
    """Logs request/response statistics for monitoring."""

    @classmethod
    def from_crawler(cls, crawler):
        middleware = cls()
        crawler.signals.connect(middleware.spider_opened, signal=signals.spider_opened)
        crawler.signals.connect(middleware.spider_closed, signal=signals.spider_closed)
        return middleware

    def spider_opened(self, spider):
        logger.info(f'Spider opened: {spider.name}')

    def spider_closed(self, spider):
        stats = spider.crawler.stats.get_stats()
        items_scraped = stats.get('item_scraped_count', 0)
        pages_downloaded = stats.get('response_received_count', 0)
        logger.info(
            f'Spider closed: {spider.name} — '
            f'{items_scraped} items scraped from {pages_downloaded} pages'
        )

    def process_response(self, request, response, spider):
        if response.status >= 400:
            logger.warning(
                f'HTTP {response.status} for {request.url} '
                f'(spider: {spider.name})'
            )
        return response
