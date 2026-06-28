"""
Facebook business page scraper spider.
Ports the JavaScript scrapeFacebookBusinessPage().
"""

import re
import json
import scrapy

from scraper.items import ContactItem
from utils import (
    normalize_phone,
    extract_phones_from_text,
    extract_emails_from_text,
    extract_social_handle,
    extract_whatsapp_from_text,
    extract_addresses_from_text,
    clean_business_name,
    unique_matches,
)


class FacebookSpider(scrapy.Spider):
    """
    Scrapes public business information from Facebook pages.
    Note: Facebook heavily restricts server-side scraping.
    This spider extracts whatever is available in the initial HTML response.
    """
    name = 'facebook'
    allowed_domains = ['facebook.com', 'www.facebook.com', 'm.facebook.com']

    custom_settings = {
        'ROBOTSTXT_OBEY': False,  # Facebook's robots.txt blocks everything
        'DOWNLOAD_DELAY': 2.0,     # Be extra polite
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
        page_title = response.css('title::text').get('') or ''
        url_path = response.url.split('facebook.com')[-1].split('?')[0].rstrip('/')
        
        if 'log in' in page_title.lower() or 'log into' in page_title.lower() or url_path in ('', '/', '/login'):
            self.logger.warning(f"Facebook root or login page detected: {response.url}")
            raise Exception("Facebook root/login page reached. Facebook blocks unauthenticated cloud scraping. Please provide a direct public Facebook Business Page URL or use Local Browser mode.")

        visible_text = ' '.join(response.css('body ::text').getall())

        # Name
        name = clean_business_name(
            response.css('h1::text').get('')
            or response.css('meta[property="og:title"]::attr(content)').get('')
            or response.css('title::text').get('')
        )

        # JSON-LD structured data
        structured_phones = []
        structured_emails = []
        structured_websites = []
        structured_addresses = []
        structured_socials = []
        structured_whatsapp = []

        for script in response.css('script[type="application/ld+json"]::text').getall():
            try:
                data = json.loads(script)
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    if item.get('telephone'):
                        p = normalize_phone(item['telephone'])
                        if p:
                            structured_phones.append(p)
                    if item.get('email'):
                        structured_emails.append(item['email'])
                    if item.get('url'):
                        structured_websites.append(item['url'])
                    addr = item.get('address')
                    if isinstance(addr, str):
                        structured_addresses.append(addr)
                    elif isinstance(addr, dict):
                        parts = [
                            addr.get('streetAddress'),
                            addr.get('addressLocality'),
                            addr.get('addressRegion'),
                        ]
                        addr_str = ', '.join(p for p in parts if p)
                        if addr_str:
                            structured_addresses.append(addr_str)
                    same_as = item.get('sameAs', [])
                    if isinstance(same_as, str):
                        same_as = [same_as]
                    for url in same_as:
                        handle = extract_social_handle(url)
                        if handle:
                            structured_socials.append(handle)
            except (json.JSONDecodeError, TypeError):
                pass

        # Emails from mailto links and text
        mailto_emails = [
            re.sub(r'^mailto:', '', h, flags=re.IGNORECASE).strip()
            for h in response.css('a[href^="mailto:"]::attr(href)').getall()
        ]
        text_emails = extract_emails_from_text(visible_text)

        # Phones from tel links and text
        tel_phones = [
            normalize_phone(h) for h in response.css('a[href^="tel:"]::attr(href)').getall()
        ]
        tel_phones = [p for p in tel_phones if p]
        text_phones = extract_phones_from_text(visible_text)

        # WhatsApp
        whatsapp = []
        for href in response.css('a[href]::attr(href)').getall():
            if re.search(r'wa\.me|whatsapp\.com', href, re.IGNORECASE):
                match = re.search(r'(\+?\d[\d]{6,})', href)
                if match:
                    phone = normalize_phone(match.group(1))
                    if phone:
                        whatsapp.append(phone)
        text_whatsapp = extract_whatsapp_from_text(visible_text)

        # Website (non-Facebook)
        website = ''
        for url in structured_websites:
            if 'facebook.com' not in url:
                website = url
                break

        # Social handles from all links
        socials = list(structured_socials)
        for href in response.css('a[href]::attr(href)').getall():
            handle = extract_social_handle(href)
            if handle:
                socials.append(handle)

        # Addresses
        addresses = structured_addresses + extract_addresses_from_text(visible_text)

        item = ContactItem()
        item['name'] = name
        item['company_name'] = name
        item['phone_numbers'] = unique_matches([*structured_phones, *tel_phones, *text_phones])
        item['whatsapp_numbers'] = unique_matches([*whatsapp, *text_whatsapp])
        item['social_media_handles'] = unique_matches(socials)
        item['emails'] = unique_matches([*structured_emails, *mailto_emails, *text_emails])
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
