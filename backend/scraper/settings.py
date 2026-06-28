"""
Scrapy settings optimized for contact scraping.
"""

BOT_NAME = 'edgewebscraper'

SPIDER_MODULES = ['scraper.spiders']
NEWSPIDER_MODULE = 'scraper.spiders'

# Polite crawling
CONCURRENT_REQUESTS = 8
CONCURRENT_REQUESTS_PER_DOMAIN = 4
DOWNLOAD_DELAY = 0.5
RANDOMIZE_DOWNLOAD_DELAY = True

# Autothrottle for adaptive rate limiting
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 0.5
AUTOTHROTTLE_MAX_DELAY = 10
AUTOTHROTTLE_TARGET_CONCURRENCY = 4.0

# Respect robots.txt
ROBOTSTXT_OBEY = True

# Depth limit for website crawls
DEPTH_LIMIT = 3

# Realistic user agent
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
)

# Timeouts
DOWNLOAD_TIMEOUT = 15

# Retry configuration
RETRY_ENABLED = True
RETRY_TIMES = 2
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]

# Item pipelines (order matters)
ITEM_PIPELINES = {
    'scraper.pipelines.CleaningPipeline': 100,
    'scraper.pipelines.DeduplicationPipeline': 200,
    'scraper.pipelines.StoragePipeline': 300,
}

# Disable Scrapy's built-in telnet console
TELNETCONSOLE_ENABLED = False

# Logging
LOG_LEVEL = 'INFO'
LOG_FORMAT = '%(asctime)s [%(name)s] %(levelname)s: %(message)s'

# Request fingerprinting (Scrapy 2.7+)
REQUEST_FINGERPRINTER_IMPLEMENTATION = '2.7'

# Disable reactor check so Scrapy uses whichever reactor crochet has initialized (EPollReactor on Linux/Render)
TWISTED_REACTOR = None

# Feed export encoding
FEED_EXPORT_ENCODING = 'utf-8'

# Disable cookies by default (less tracking)
COOKIES_ENABLED = False

# Default request headers
DEFAULT_REQUEST_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
}
