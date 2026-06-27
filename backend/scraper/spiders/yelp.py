"""
Yelp business scraper spider.
Ports the JavaScript scrapeYelpResultsPage() and scrapeYelpBusinessPage().
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
    clean_business_name,
    is_likely_noise,
    unique_matches,
)


class YelpSpider(scrapy.Spider):
    """Scrapes business listings and details from Yelp."""
    name = 'yelp'
    allowed_domains = ['yelp.com', 'www.yelp.com']

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

        if self._is_business_page(response.url):
            yield from self._parse_business_page(response)
        else:
            yield from self._parse_results_page(response)

    def _is_business_page(self, url: str) -> bool:
        return bool(re.search(r'/biz/[^/]+', url))

    def _parse_results_page(self, response):
        """Parse a Yelp search results page."""
        biz_links = response.css('a[href*="/biz/"]')
        seen = set()

        for link in biz_links:
            href = link.attrib.get('href', '')
            abs_url = urljoin(response.url, href)

            if not self._is_business_page(abs_url):
                continue
            if abs_url in seen:
                continue
            seen.add(abs_url)

            # Extract card info
            card = link.xpath('ancestor::*[self::li or self::div[@class]]')
            card_el = card[-1] if card else link

            name_text = (
                link.attrib.get('name')
                or link.attrib.get('aria-label')
                or link.css('::text').get('')
            )
            name = clean_business_name(name_text)
            if not name or is_likely_noise(name):
                continue

            card_text = ' '.join(card_el.css('::text').getall())
            phones = extract_phones_from_text(card_text)
            emails = extract_emails_from_text(card_text)

            # Extract social handles from links in the card
            socials = []
            for a_href in card_el.css('a[href]::attr(href)').getall():
                handle = extract_social_handle(a_href)
                if handle:
                    socials.append(handle)

            # Extract WhatsApp
            whatsapp = []
            for a_href in card_el.css('a[href]::attr(href)').getall():
                if re.search(r'wa\.me|whatsapp\.com', a_href, re.IGNORECASE):
                    match = re.search(r'(\+?\d[\d]{6,})', a_href)
                    if match:
                        phone = normalize_phone(match.group(1))
                        if phone:
                            whatsapp.append(phone)

            item = ContactItem()
            item['name'] = name
            item['company_name'] = name
            item['phone_numbers'] = phones
            item['whatsapp_numbers'] = whatsapp
            item['social_media_handles'] = unique_matches(socials)
            item['emails'] = emails
            item['website'] = ''
            item['address'] = ''
            item['category'] = ''
            item['rating'] = ''
            item['review_count'] = ''
            item['source_url'] = abs_url
            item['page_title'] = response.css('title::text').get('')
            yield item

            # Follow to business page for more details in crawl mode
            if self.mode in ('crawl', 'marketplace') and self.pages_scraped < self.max_pages:
                yield scrapy.Request(
                    url=abs_url,
                    callback=self._parse_business_page_callback,
                    errback=self.handle_error,
                    meta={'listing_name': name},
                )

    def _parse_business_page_callback(self, response):
        self.pages_scraped += 1
        yield from self._parse_business_page(response)

    def _parse_business_page(self, response):
        """Parse an individual Yelp business page."""
        name = clean_business_name(
            response.css('h1::text').get('')
            or response.css('meta[property="og:title"]::attr(content)').get('')
            or response.css('title::text').get('')
        )

        # Phone numbers
        tel_links = response.css('a[href^="tel:"]::attr(href)').getall()
        phones_from_links = [normalize_phone(h) for h in tel_links]
        phones_from_links = [p for p in phones_from_links if p]

        visible_text = ' '.join(response.css('body ::text').getall())
        phones_from_text = extract_phones_from_text(visible_text)

        # Emails
        mailto_links = response.css('a[href^="mailto:"]::attr(href)').getall()
        emails_from_links = [
            re.sub(r'^mailto:', '', h, flags=re.IGNORECASE).strip()
            for h in mailto_links
        ]
        emails_from_text = extract_emails_from_text(visible_text)

        # Social handles
        socials = []
        for href in response.css('a[href]::attr(href)').getall():
            handle = extract_social_handle(href)
            if handle:
                socials.append(handle)

        # WhatsApp
        whatsapp = []
        for href in response.css('a[href]::attr(href)').getall():
            if re.search(r'wa\.me|whatsapp\.com', href, re.IGNORECASE):
                match = re.search(r'(\+?\d[\d]{6,})', href)
                if match:
                    phone = normalize_phone(match.group(1))
                    if phone:
                        whatsapp.append(phone)

        item = ContactItem()
        item['name'] = name
        item['company_name'] = name
        item['phone_numbers'] = unique_matches([*phones_from_links, *phones_from_text])
        item['whatsapp_numbers'] = unique_matches(whatsapp)
        item['social_media_handles'] = unique_matches(socials)
        item['emails'] = unique_matches([*emails_from_links, *emails_from_text])
        item['website'] = ''
        item['address'] = ''
        item['category'] = ''
        item['rating'] = ''
        item['review_count'] = ''
        item['source_url'] = response.url
        item['page_title'] = response.css('title::text').get('')
        yield item

    def handle_error(self, failure):
        self.logger.warning(f'Request failed: {failure.request.url} — {failure.value}')
