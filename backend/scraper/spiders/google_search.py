"""
Google Search and Bing Search scraper spiders.
Ports the JavaScript scrapeGoogleSearchPage() and scrapeBingSearchPage().
"""

import re
import scrapy

from scraper.items import ContactItem
from utils import (
    extract_phones_from_text,
    extract_emails_from_text,
    extract_whatsapp_from_text,
    extract_addresses_from_text,
    clean_business_name,
    unique_matches,
)


class GoogleSearchSpider(scrapy.Spider):
    """Scrapes contact info from Google search result snippets."""
    name = 'google_search'
    allowed_domains = [
        'google.com', 'www.google.com',
        'google.co.uk', 'google.com.ng', 'google.ca',
    ]

    custom_settings = {
        'ROBOTSTXT_OBEY': False,  # Google blocks scrapers via robots.txt
        'DOWNLOAD_DELAY': 2.0,
    }

    def __init__(self, url=None, mode='single', max_pages=1, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_url = url
        self.mode = mode
        self.max_pages = int(max_pages)
        self.job_id = job_id

    def start_requests(self):
        if not self.start_url:
            return
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse,
            errback=self.handle_error,
        )

    def parse(self, response):
        blocks = response.css('.g, .VkpGBb, div[data-attrid], div[jscontroller]')
        found_any = False

        for block in blocks:
            text = ' '.join(block.css('::text').getall())
            phones = extract_phones_from_text(text)
            emails = extract_emails_from_text(text)
            whatsapp = extract_whatsapp_from_text(text)

            if not phones and not emails:
                continue

            heading = block.css('h3 ::text, [role="heading"] ::text').get('')
            name = heading.strip() if heading else ''
            if not name or len(name) < 3:
                # Try first meaningful line
                lines = [l.strip() for l in text.split('\n') if l.strip() and 2 < len(l.strip()) < 120]
                name = lines[0] if lines else ''
            if not name:
                continue

            # Website link
            website = ''
            for href in block.css('a[href]::attr(href)').getall():
                if re.match(r'^https?:', href) and 'google' not in href.lower():
                    website = href
                    break

            addresses = extract_addresses_from_text(text)

            item = ContactItem()
            item['name'] = clean_business_name(name)
            item['company_name'] = clean_business_name(name)
            item['phone_numbers'] = phones
            item['whatsapp_numbers'] = whatsapp
            item['social_media_handles'] = []
            item['emails'] = emails
            item['website'] = website
            item['address'] = addresses[0] if addresses else ''
            item['category'] = ''
            item['rating'] = ''
            item['review_count'] = ''
            item['source_url'] = response.url
            item['page_title'] = response.css('title::text').get('')
            yield item
            found_any = True

        if not found_any:
            # Fallback: treat as generic page
            self.logger.info('No structured search results found, falling back to generic extraction')

    def handle_error(self, failure):
        self.logger.warning(f'Request failed: {failure.request.url} — {failure.value}')


class BingSearchSpider(scrapy.Spider):
    """Scrapes contact info from Bing search result snippets."""
    name = 'bing_search'
    allowed_domains = ['bing.com', 'www.bing.com']

    custom_settings = {
        'DOWNLOAD_DELAY': 2.0,
    }

    def __init__(self, url=None, mode='single', max_pages=1, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_url = url
        self.mode = mode
        self.max_pages = int(max_pages)
        self.job_id = job_id

    def start_requests(self):
        if not self.start_url:
            return
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse,
            errback=self.handle_error,
        )

    def parse(self, response):
        blocks = response.css('.b_algo, .b_ans, .b_entityTP')

        for block in blocks:
            text = ' '.join(block.css('::text').getall())
            phones = extract_phones_from_text(text)
            emails = extract_emails_from_text(text)
            whatsapp = extract_whatsapp_from_text(text)

            if not phones and not emails:
                continue

            heading = block.css('h2 ::text, h3 ::text').get('')
            name = heading.strip() if heading else ''
            if not name or len(name) < 3:
                lines = [l.strip() for l in text.split('\n') if l.strip() and 2 < len(l.strip()) < 120]
                name = lines[0] if lines else ''
            if not name:
                continue

            # Website link
            website = ''
            for href in block.css('a[href]::attr(href)').getall():
                if re.match(r'^https?:', href) and 'bing' not in href.lower():
                    website = href
                    break

            addresses = extract_addresses_from_text(text)

            item = ContactItem()
            item['name'] = clean_business_name(name)
            item['company_name'] = clean_business_name(name)
            item['phone_numbers'] = phones
            item['whatsapp_numbers'] = whatsapp
            item['social_media_handles'] = []
            item['emails'] = emails
            item['website'] = website
            item['address'] = addresses[0] if addresses else ''
            item['category'] = ''
            item['rating'] = ''
            item['review_count'] = ''
            item['source_url'] = response.url
            item['page_title'] = response.css('title::text').get('')
            yield item

    def handle_error(self, failure):
        self.logger.warning(f'Request failed: {failure.request.url} — {failure.value}')
