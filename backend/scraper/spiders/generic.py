"""
Generic contact spider — scrapes contact information from any website.
Ports the JavaScript scrapeGenericDocument() and website crawling logic.
"""

import re
import json
import scrapy
from urllib.parse import urlparse, urljoin

from scraper.items import ContactItem
from utils import (
    normalize_phone,
    extract_phones_from_text,
    extract_emails_from_text,
    extract_emails_from_html,
    extract_whatsapp_from_text,
    extract_addresses_from_text,
    extract_social_handle,
    extract_social_links,
    clean_business_name,
    looks_like_company,
    score_internal_link,
    unique_matches,
)


class GenericContactSpider(scrapy.Spider):
    """
    Scrapes contact information from any website.
    Supports single-page and multi-page crawl modes.
    """
    name = 'generic'

    custom_settings = {
        'DEPTH_LIMIT': 3,
    }

    def __init__(self, url=None, mode='single', max_pages=12, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_url = url
        self.mode = mode
        self.max_pages = int(max_pages)
        self.job_id = job_id
        self.pages_scraped = 0
        self.scraped_urls = set()

    def start_requests(self):
        if not self.start_url:
            self.logger.error('No URL provided')
            return
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse,
            errback=self.handle_error,
            meta={'is_start_page': True},
        )

    def parse(self, response):
        self.pages_scraped += 1
        self.scraped_urls.add(response.url)

        # Extract contacts from this page
        yield from self._extract_contacts(response)

        # If crawl mode, discover and follow internal links
        if self.mode == 'crawl' and self.pages_scraped < self.max_pages:
            yield from self._discover_links(response)

    def _extract_contacts(self, response):
        """Extract all contact information from a page."""
        page_title = response.css('title::text').get('').strip()
        page_url = response.url
        html = response.text

        # Collect from all structured data sources
        structured = self._extract_structured_contacts(response)
        text = self._get_visible_text(response)

        # Regex-based extraction from visible text
        regex_emails = extract_emails_from_text(text)
        regex_phones = extract_phones_from_text(text)
        regex_whatsapp = extract_whatsapp_from_text(text)
        regex_addresses = extract_addresses_from_text(text)

        # Link-based extraction
        social_handles = []
        whatsapp_from_links = []
        for href in response.css('a[href]::attr(href)').getall():
            # Social handles
            handle = extract_social_handle(href)
            if handle:
                social_handles.append(handle)
            # WhatsApp links
            if re.search(r'wa\.me|whatsapp\.com', href, re.IGNORECASE):
                match = re.search(r'(\+?\d[\d]{6,})', href)
                if match:
                    phone = normalize_phone(match.group(1))
                    if phone:
                        whatsapp_from_links.append(phone)

        # Merge all sources
        all_emails = unique_matches([*structured['emails'], *regex_emails])
        all_phones = unique_matches([*structured['phones'], *regex_phones])
        all_whatsapp = unique_matches([*structured['whatsapp'], *regex_whatsapp, *whatsapp_from_links])
        all_socials = unique_matches([*structured['socials'], *social_handles])
        all_addresses = unique_matches([*structured['addresses'], *regex_addresses])
        all_names = unique_matches(structured['names'])
        all_companies = unique_matches(structured['companies'])
        all_websites = unique_matches(structured['websites'])

        # Build listings — try to align data into rows
        max_len = max(
            len(all_names), len(all_companies), len(all_phones),
            len(all_whatsapp), len(all_socials), len(all_emails),
            len(all_websites), len(all_addresses), 1,
        )

        for i in range(max_len):
            name = all_names[i] if i < len(all_names) else ''
            company = all_companies[i] if i < len(all_companies) else ''
            if not name and not company and i >= len(all_phones) and i >= len(all_emails):
                continue

            item = ContactItem()
            item['name'] = name
            item['company_name'] = company
            item['phone_numbers'] = [all_phones[i]] if i < len(all_phones) else []
            item['whatsapp_numbers'] = [all_whatsapp[i]] if i < len(all_whatsapp) else []
            item['social_media_handles'] = [all_socials[i]] if i < len(all_socials) else []
            item['emails'] = [all_emails[i]] if i < len(all_emails) else []
            item['website'] = all_websites[i] if i < len(all_websites) else ''
            item['address'] = all_addresses[i] if i < len(all_addresses) else ''
            item['category'] = ''
            item['rating'] = ''
            item['review_count'] = ''
            item['source_url'] = page_url
            item['page_title'] = page_title

            yield item

    def _extract_structured_contacts(self, response):
        """
        Extract contacts from structured data sources.
        Port of JavaScript extractStructuredContacts().
        """
        extracted = {
            'names': [],
            'companies': [],
            'phones': [],
            'emails': [],
            'websites': [],
            'addresses': [],
            'socials': [],
            'whatsapp': [],
        }

        # 1. JSON-LD
        for script in response.css('script[type="application/ld+json"]::text').getall():
            try:
                data = json.loads(script)
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    item_type = str(item.get('@type', '')).lower()
                    if any(t in item_type for t in ['organization', 'localbusiness', 'person', 'store']):
                        if item.get('name'):
                            extracted['names'].append(item['name'])
                        if item.get('telephone'):
                            extracted['phones'].append(item['telephone'])
                        if item.get('email'):
                            extracted['emails'].append(item['email'])
                        if item.get('url'):
                            extracted['websites'].append(item['url'])
                        # Address
                        addr = item.get('address')
                        if isinstance(addr, str):
                            extracted['addresses'].append(addr)
                        elif isinstance(addr, dict):
                            parts = [
                                addr.get('streetAddress'),
                                addr.get('addressLocality'),
                                addr.get('addressRegion'),
                                addr.get('postalCode'),
                                addr.get('addressCountry'),
                            ]
                            addr_str = ', '.join(p for p in parts if p)
                            if addr_str:
                                extracted['addresses'].append(addr_str)
                        # Social links
                        same_as = item.get('sameAs', [])
                        if isinstance(same_as, str):
                            same_as = [same_as]
                        for url in same_as:
                            handle = extract_social_handle(url)
                            if handle:
                                extracted['socials'].append(handle)
                        # Contact points
                        contact_points = item.get('contactPoint', [])
                        if isinstance(contact_points, dict):
                            contact_points = [contact_points]
                        for cp in contact_points:
                            if isinstance(cp, dict):
                                if cp.get('telephone'):
                                    extracted['phones'].append(cp['telephone'])
                                if cp.get('email'):
                                    extracted['emails'].append(cp['email'])
            except (json.JSONDecodeError, TypeError, AttributeError):
                pass

        # 2. Microdata (itemprop)
        for el in response.css('[itemprop]'):
            prop = el.attrib.get('itemprop', '')
            value = el.attrib.get('content') or el.css('::attr(href)').get() or el.css('::text').get('')
            if not value:
                continue
            if prop == 'telephone':
                extracted['phones'].append(value)
            elif prop == 'email':
                extracted['emails'].append(re.sub(r'^mailto:', '', value, flags=re.IGNORECASE))
            elif prop == 'url' and re.match(r'^https?:', value, re.IGNORECASE):
                extracted['websites'].append(value)
            elif prop in ('streetAddress', 'addressLocality', 'addressRegion'):
                extracted['addresses'].append(value)
            elif prop == 'name':
                extracted['names'].append(value)

        # 3. OpenGraph / Meta
        for meta in response.css('meta[property], meta[name]'):
            key = meta.attrib.get('property') or meta.attrib.get('name', '')
            val = meta.attrib.get('content', '')
            if not val:
                continue
            if key in ('og:email', 'business:contact_data:email'):
                extracted['emails'].append(val)
            elif key in ('og:phone_number', 'business:contact_data:phone_number'):
                extracted['phones'].append(val)
            elif key == 'og:site_name':
                extracted['companies'].append(val)
            elif key in ('business:contact_data:street_address', 'business:contact_data:locality'):
                extracted['addresses'].append(val)

        # 4. tel: and mailto: links
        for href in response.css('a[href^="tel:"]::attr(href)').getall():
            phone = normalize_phone(href)
            if phone:
                extracted['phones'].append(phone)

        for href in response.css('a[href^="mailto:"]::attr(href)').getall():
            email = re.sub(r'^mailto:', '', href, flags=re.IGNORECASE).strip()
            if email:
                extracted['emails'].append(email)

        # 5. data-* attributes
        for attr_name in ('data-phone', 'data-tel', 'data-telephone', 'data-mobile', 'data-contact-phone'):
            for el in response.css(f'[{attr_name}]'):
                val = el.attrib.get(attr_name.replace('data-', ''), '') or el.attrib.get(attr_name, '')
                if val:
                    extracted['phones'].append(val)

        for attr_name in ('data-email', 'data-contact-email'):
            for el in response.css(f'[{attr_name}]'):
                val = el.attrib.get(attr_name.replace('data-', ''), '') or el.attrib.get(attr_name, '')
                if val:
                    extracted['emails'].append(val)

        for el in response.css('[data-whatsapp]'):
            val = el.attrib.get('data-whatsapp', '')
            if val:
                extracted['whatsapp'].append(val)

        # Normalize phones
        extracted['phones'] = [p for p in (normalize_phone(p) for p in extracted['phones']) if p]
        extracted['whatsapp'] = [p for p in (normalize_phone(p) for p in extracted['whatsapp']) if p]

        return extracted

    def _get_visible_text(self, response):
        """Extract visible text from the page, excluding scripts/styles."""
        # Remove script, style, noscript content
        text_parts = response.xpath(
            '//body//text()[not(ancestor::script) and not(ancestor::style) '
            'and not(ancestor::noscript)]'
        ).getall()
        return ' '.join(t.strip() for t in text_parts if t.strip())

    def _discover_links(self, response):
        """
        Discover and score internal links for contact-relevant pages.
        Port of JavaScript buildWebsiteQueue().
        """
        try:
            base_origin = f'{urlparse(response.url).scheme}://{urlparse(response.url).netloc}'
        except Exception:
            return

        scored_links = []
        seen = set(self.scraped_urls)

        for anchor in response.css('a[href]'):
            href = anchor.attrib.get('href', '')
            text = anchor.css('::text').get('').strip()
            rel = anchor.attrib.get('rel', '')

            try:
                abs_url = urljoin(response.url, href)
                parsed = urlparse(abs_url)
                link_origin = f'{parsed.scheme}://{parsed.netloc}'

                if link_origin != base_origin:
                    continue
                if parsed.scheme not in ('http', 'https'):
                    continue

                # Strip fragment
                clean_url = abs_url.split('#')[0]
                if clean_url in seen:
                    continue

                seen.add(clean_url)
                link_score = score_internal_link(clean_url, text, rel)
                path_depth = len([p for p in parsed.path.split('/') if p])

                scored_links.append((clean_url, link_score, path_depth))
            except Exception:
                continue

        # Sort by score desc, then path depth asc
        scored_links.sort(key=lambda x: (-x[1], x[2]))

        # Follow top-scored links up to limit
        remaining = self.max_pages - self.pages_scraped
        for url, link_score, _ in scored_links:
            if remaining <= 0:
                break
            if link_score <= -5:
                continue
            remaining -= 1
            yield scrapy.Request(
                url=url,
                callback=self.parse,
                errback=self.handle_error,
                priority=link_score,
            )

    def handle_error(self, failure):
        self.logger.warning(f'Request failed: {failure.request.url} — {failure.value}')
