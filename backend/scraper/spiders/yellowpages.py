"""
Yellow Pages scraper spider.
Ports the JavaScript scrapeYellowPagesDocument().
"""

import re
import scrapy
from urllib.parse import urljoin

from scraper.items import ContactItem
from utils import (
    normalize_phone,
    extract_phones_from_text,
    extract_emails_from_text,
    extract_social_handle,
    extract_addresses_from_text,
    clean_business_name,
    unique_matches,
)


class YellowPagesSpider(scrapy.Spider):
    """Scrapes business listings from Yellow Pages."""
    name = 'yellowpages'
    allowed_domains = ['yellowpages.com', 'www.yellowpages.com', 'yp.com', 'www.yp.com']

    def __init__(self, url=None, mode='single', max_pages=12, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_url = url
        self.mode = mode
        self.max_pages = int(max_pages)
        self.job_id = job_id
        self.pages_scraped = 0

    def start_requests(self):
        if not self.start_url:
            return
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse,
            errback=self.handle_error,
        )

    def parse(self, response):
        self.pages_scraped += 1

        if '/search' in response.url:
            yield from self._parse_search_results(response)
        else:
            yield from self._parse_detail_page(response)

    def _parse_search_results(self, response):
        """Parse Yellow Pages search results page."""
        cards = response.css('.srp-listing, .search-results .result, .v-card')

        for card in cards:
            # Name
            name_node = card.css('.business-name ::text, h2 ::text, .n ::text, [itemprop="name"] ::text').get()
            if not name_node:
                continue
            name = clean_business_name(name_node)

            # Detail URL
            detail_link = (
                card.css('a[href*="/mip/"]::attr(href)').get()
                or card.css('.business-name a::attr(href)').get()
                or ''
            )
            detail_url = urljoin(response.url, detail_link) if detail_link else response.url

            # Phone
            phone_node = card.css('.phones ::text, .phone ::text, [itemprop="telephone"] ::text').get()
            if phone_node:
                phone = normalize_phone(phone_node)
                phones = [phone] if phone else []
            else:
                card_text = ' '.join(card.css('::text').getall())
                phones = extract_phones_from_text(card_text)

            # Address
            address_node = card.css('.adr ::text, .address ::text, [itemprop="address"] ::text').getall()
            address = re.sub(r'\s+', ' ', ' '.join(address_node)).strip() if address_node else ''

            # Website
            website = card.css('a.track-visit-website::attr(href)').get('')
            if not website:
                for href in card.css('a[href^="http"]::attr(href)').getall():
                    if 'yellowpages' not in href and 'yp.com' not in href:
                        website = href
                        break

            # Category
            category_text = card.css('.categories ::text, .info-primary ::text').getall()
            category = re.sub(r'\s+', ' ', ' '.join(category_text)).strip()

            # Socials
            socials = []
            for href in card.css('a[href]::attr(href)').getall():
                handle = extract_social_handle(href)
                if handle:
                    socials.append(handle)

            # Emails
            card_text = ' '.join(card.css('::text').getall())
            emails = extract_emails_from_text(card_text)

            item = ContactItem()
            item['name'] = name
            item['company_name'] = name
            item['phone_numbers'] = phones
            item['whatsapp_numbers'] = []
            item['social_media_handles'] = unique_matches(socials)
            item['emails'] = emails
            item['website'] = website
            item['address'] = address
            item['category'] = category
            item['rating'] = ''
            item['review_count'] = ''
            item['source_url'] = detail_url
            item['page_title'] = response.css('title::text').get('')
            yield item

            # Follow to detail page
            if (
                self.mode in ('crawl', 'marketplace')
                and self.pages_scraped < self.max_pages
                and detail_link
                and '/mip/' in detail_link
            ):
                yield scrapy.Request(
                    url=detail_url,
                    callback=self._parse_detail_callback,
                    errback=self.handle_error,
                )

    def _parse_detail_callback(self, response):
        self.pages_scraped += 1
        yield from self._parse_detail_page(response)

    def _parse_detail_page(self, response):
        """Parse a Yellow Pages business detail page."""
        name = clean_business_name(
            response.css('h1::text').get('')
            or response.css('title::text').get('')
        )

        visible_text = ' '.join(response.css('body ::text').getall())

        # Structured data
        structured_phones = []
        for el in response.css('[itemprop="telephone"]'):
            val = el.css('::attr(content)').get() or el.css('::text').get('')
            phone = normalize_phone(val)
            if phone:
                structured_phones.append(phone)

        structured_emails = []
        for el in response.css('[itemprop="email"]'):
            val = el.css('::attr(content)').get() or el.css('::text').get('')
            if val:
                structured_emails.append(re.sub(r'^mailto:', '', val, flags=re.IGNORECASE).strip())

        structured_names = [
            el.css('::text').get('').strip()
            for el in response.css('[itemprop="name"]')
            if el.css('::text').get('').strip()
        ]

        structured_addresses = []
        for el in response.css('[itemprop="address"]'):
            addr_text = ' '.join(el.css('::text').getall())
            addr = re.sub(r'\s+', ' ', addr_text).strip()
            if addr:
                structured_addresses.append(addr)

        structured_websites = []
        for el in response.css('[itemprop="url"]'):
            url = el.css('::attr(href)').get() or el.css('::attr(content)').get('')
            if url and re.match(r'^https?:', url, re.IGNORECASE):
                structured_websites.append(url)

        # Socials
        socials = []
        for href in response.css('a[href]::attr(href)').getall():
            handle = extract_social_handle(href)
            if handle:
                socials.append(handle)

        item = ContactItem()
        item['name'] = structured_names[0] if structured_names else name
        item['company_name'] = name
        item['phone_numbers'] = unique_matches([*structured_phones, *extract_phones_from_text(visible_text)])
        item['whatsapp_numbers'] = []
        item['social_media_handles'] = unique_matches(socials)
        item['emails'] = unique_matches([*structured_emails, *extract_emails_from_text(visible_text)])
        item['website'] = structured_websites[0] if structured_websites else ''
        item['address'] = structured_addresses[0] if structured_addresses else ''
        item['category'] = ''
        item['rating'] = ''
        item['review_count'] = ''
        item['source_url'] = response.url
        item['page_title'] = response.css('title::text').get('')
        yield item

    def handle_error(self, failure):
        self.logger.warning(f'Request failed: {failure.request.url} — {failure.value}')
