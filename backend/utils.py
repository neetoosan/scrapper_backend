"""
Shared utility functions for contact extraction.
Ported from the JavaScript scraper.js utility functions.
"""

import re
from urllib.parse import urlparse, urljoin


# ── Phone normalization ─────────────────────────────────────────────────────

def normalize_phone(value: str) -> str | None:
    """
    Normalize a phone number string. Returns cleaned phone or None if invalid.
    Port of JavaScript normalizePhone().
    """
    if not value:
        return None

    cleaned = re.sub(r'^tel:', '', value, flags=re.IGNORECASE)
    cleaned = re.sub(r'[^\d+]', '', cleaned)
    digits = re.sub(r'\D', '', cleaned)

    if len(digits) < 7 or len(digits) > 15:
        return None

    # Reject all-same-digit numbers
    if re.match(r'^(\d)\1{6,}$', digits):
        return None

    if cleaned.startswith('+'):
        # Nigerian number fix: +2340... -> +234...
        if cleaned.startswith('+234') and len(digits) > 3 and digits[3] == '0':
            digits = '234' + digits[4:]
        return '+' + digits

    return digits


def extract_phones_from_text(text: str) -> list[str]:
    """
    Extract phone numbers from text using regex patterns.
    Port of JavaScript extractPhonesFromText().
    """
    if not text:
        return []

    all_phones = re.findall(r'(?:\+?\d[\d\s().\-]{6,}\d)', text)

    # Nigerian phone patterns
    naija1 = re.findall(r'0[7-9]0\d[\s.\-]?\d{3}[\s.\-]?\d{4}', text)
    naija2 = re.findall(r'0[1-9]\d[\s.\-]?\d{3}[\s.\-]?\d{4}', text)

    raw = [*all_phones, *naija1, *naija2]
    normalized = [normalize_phone(p) for p in raw]
    return list(dict.fromkeys(p for p in normalized if p))


# ── Email extraction ────────────────────────────────────────────────────────

def extract_emails_from_text(text: str) -> list[str]:
    """
    Extract email addresses from text.
    Port of JavaScript extractEmailsFromText().
    """
    if not text:
        return []

    matches = re.findall(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', text, re.IGNORECASE)
    return list(dict.fromkeys(m.strip() for m in matches if m.strip()))


def extract_emails_from_html(html: str) -> list[str]:
    """
    Extract emails from HTML including mailto: links and obfuscated patterns.
    Port of JavaScript extractEmailsFromHtml() in gmaps-scraper.js.
    """
    if not html:
        return []

    expanded = html.replace('%40', '@')
    expanded = re.sub(r'\s*\[\s*at\s*\]\s*', '@', expanded, flags=re.IGNORECASE)
    expanded = re.sub(r'\s*\(\s*at\s*\)\s*', '@', expanded, flags=re.IGNORECASE)
    expanded = re.sub(r'\s*\[\s*dot\s*\]\s*', '.', expanded, flags=re.IGNORECASE)
    expanded = re.sub(r'\s*\(\s*dot\s*\)\s*', '.', expanded, flags=re.IGNORECASE)

    mailto_matches = re.findall(r'mailto:([^"\'>?\s]+)', html, re.IGNORECASE)
    regex_matches = re.findall(
        r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
        expanded,
    )

    bad_extensions = re.compile(
        r'\.(png|jpg|jpeg|gif|svg|webp|css|js|pdf|woff2?|ttf|eot|ico|map)$',
        re.IGNORECASE,
    )
    bad_domains = re.compile(
        r'sentry|wixpress|example\.com|webpack|cloudflare|googleapis|gravatar|domain\.com',
        re.IGNORECASE,
    )

    seen = set()
    result = []
    for email in [*regex_matches, *mailto_matches]:
        email = email.strip()
        low = email.lower()
        if (
            len(low) < 80
            and not bad_extensions.search(low)
            and not bad_domains.search(low)
            and not low.startswith('u00')
            and low not in seen
        ):
            seen.add(low)
            result.append(email)

    return result


# ── WhatsApp extraction ─────────────────────────────────────────────────────

def extract_whatsapp_from_text(text: str) -> list[str]:
    """
    Extract WhatsApp numbers from text.
    Port of JavaScript extractWhatsappFromText().
    """
    if not text:
        return []

    patterns = [
        r'WhatsApp:?\s*(\+?\d[\d\s.\-]{6,}\d)',
        r'WA:?\s*(\+?\d[\d\s.\-]{6,}\d)',
        r'Chat (?:me |us )?on WhatsApp:?\s*(\+?\d[\d\s.\-]{6,}\d)',
        r'Whatsapp (?:no|number|#):?\s*(\+?\d[\d\s.\-]{6,}\d)',
    ]

    extracted = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            if match.group(1):
                extracted.append(match.group(1))

    return list(dict.fromkeys(extracted))


# ── Address extraction ──────────────────────────────────────────────────────

def extract_addresses_from_text(text: str) -> list[str]:
    """
    Extract street addresses from text.
    Port of JavaScript extractAddressesFromText().
    """
    if not text:
        return []

    addresses = []

    street_pattern = (
        r'\b\d{1,5}\s+[A-Za-z0-9.\-\'\s]+(?:Road|Rd|Street|St|Avenue|Ave|'
        r'Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Close|Crescent|Court|Ct|'
        r'Highway|Hwy|Estate|Layout|Terrace|Mews|Place|Square|Circle|'
        r'Loop|Trail|Parkway|Pkwy)\b[^|\n]{0,80}'
    )
    matches = re.findall(street_pattern, text, re.IGNORECASE)
    addresses.extend(matches)

    po_box = re.findall(r'P\.?\s*O\.?\s*Box\s+\d+[^\n]{0,60}', text, re.IGNORECASE)
    addresses.extend(po_box)

    return [re.sub(r'\s+', ' ', a).strip() for a in addresses]


# ── Social media extraction ────────────────────────────────────────────────

SOCIAL_PATTERNS = [
    ('LinkedIn', re.compile(r'linkedin\.com/(?:in|company)/([^/?#]+)', re.IGNORECASE)),
    ('X', re.compile(r'(?:twitter|x)\.com/([^/?#]+)', re.IGNORECASE)),
    ('Instagram', re.compile(r'instagram\.com/([^/?#]+)', re.IGNORECASE)),
    ('Facebook', re.compile(r'facebook\.com/([^/?#]+)', re.IGNORECASE)),
    ('TikTok', re.compile(r'tiktok\.com/@?([^/?#]+)', re.IGNORECASE)),
    ('YouTube', re.compile(r'youtube\.com/(?:@|channel/|c/)?([^/?#]+)', re.IGNORECASE)),
    ('Pinterest', re.compile(r'pinterest\.com/([^/?#]+)', re.IGNORECASE)),
    ('Snapchat', re.compile(r'snapchat\.com/add/([^/?#]+)', re.IGNORECASE)),
    ('Telegram', re.compile(r't\.me/([^/?#]+)', re.IGNORECASE)),
    ('Threads', re.compile(r'threads\.net/@?([^/?#]+)', re.IGNORECASE)),
    ('GitHub', re.compile(r'github\.com/([^/?#]+)', re.IGNORECASE)),
]

SOCIAL_EXCLUDE = re.compile(
    r'/(sharer|share|intent/|dialog/|login|signup|redirect)',
    re.IGNORECASE,
)


def extract_social_handle(url: str) -> str | None:
    """
    Extract a social media handle from a URL.
    Port of JavaScript extractSocialHandle().
    """
    if not url or SOCIAL_EXCLUDE.search(url):
        return None

    for label, regex in SOCIAL_PATTERNS:
        match = regex.search(url)
        if match and match.group(1):
            from urllib.parse import unquote
            return f'{label}: {unquote(match.group(1))}'

    return None


def extract_social_links(html: str) -> dict[str, str]:
    """
    Extract social media profile URLs from HTML.
    Port of JavaScript extractSocialLinks() in gmaps-scraper.js.
    """
    socials = {'facebook': '', 'instagram': '', 'twitter': '', 'linkedin': ''}

    patterns = {
        'facebook': re.compile(
            r'https?://(?:www\.)?facebook\.com/(?!sharer|share|dialog|login|plugins|watch|photo|groups/\d)([a-zA-Z0-9._\-]+)',
            re.IGNORECASE,
        ),
        'instagram': re.compile(
            r'https?://(?:www\.)?instagram\.com/(?!p/|explore|tags|accounts|about|developer|legal|reel)([a-zA-Z0-9._]+)',
            re.IGNORECASE,
        ),
        'twitter': re.compile(
            r'https?://(?:www\.)?(?:twitter|x)\.com/(?!intent|share|home|search|login|signup|i/web)([a-zA-Z0-9_]+)',
            re.IGNORECASE,
        ),
        'linkedin': re.compile(
            r'https?://(?:www\.)?linkedin\.com/(?:company|in)/([a-zA-Z0-9._\-]+)',
            re.IGNORECASE,
        ),
    }

    for key, pattern in patterns.items():
        match = pattern.search(html)
        if match:
            handle = match.group(1)
            if key == 'facebook':
                socials[key] = f'https://facebook.com/{handle}'
            elif key == 'instagram':
                socials[key] = f'https://instagram.com/{handle}'
            elif key == 'twitter':
                socials[key] = f'https://x.com/{handle}'
            elif key == 'linkedin':
                socials[key] = match.group(0).split('?')[0]

    return socials


# ── Business name utilities ─────────────────────────────────────────────────

def clean_business_name(value: str) -> str:
    """
    Clean a business name string.
    Port of JavaScript cleanBusinessName().
    """
    cleaned = re.sub(r'\s+', ' ', value)
    cleaned = re.sub(
        r'\b(plus code|directions|website|call|share|save)\b.*$',
        '',
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def is_likely_noise(value: str) -> bool:
    """
    Check if a string is likely navigation noise rather than a real name.
    Port of JavaScript isLikelyNoise().
    """
    normalized = value.lower().strip()
    exact_matches = [
        'results', 'google maps', 'menu', 'overview', 'about',
        'home', 'directions', 'share', 'save',
    ]
    if normalized in exact_matches:
        return True
    return len(value) < 2


def looks_like_company(value: str) -> bool:
    """
    Check if a string looks like a company name.
    Port of JavaScript looksLikeCompany().
    """
    return bool(re.search(
        r'\b(inc|llc|ltd|limited|corp|corporation|company|group|studio|'
        r'agency|solutions|technologies|tech|systems|labs|media|ventures)\b',
        value,
        re.IGNORECASE,
    ))


# ── URL utilities ───────────────────────────────────────────────────────────

def score_internal_link(url: str, text: str = '', rel: str = '') -> int:
    """
    Score an internal link for relevance to contact information.
    Port of JavaScript scoreInternalLink().
    """
    try:
        parsed = urlparse(url)
        value = f'{parsed.path} {text} {rel}'.lower()
    except Exception:
        value = f'{url} {text} {rel}'.lower()

    score = 0

    strong_matches = [
        'contact', 'about', 'team', 'staff', 'leadership', 'company',
        'people', 'management', 'our-story', 'yellowpages', 'facebook',
    ]
    medium_matches = [
        'service', 'support', 'location', 'directory', 'branch',
        'office', 'meet', 'connect',
    ]
    weak_avoid = [
        'privacy', 'terms', 'policy', 'login', 'signin', 'signup',
        'register', 'cart', 'checkout', 'search', 'blog', 'post', 'article',
    ]

    for token in strong_matches:
        if token in value:
            score += 8

    for token in medium_matches:
        if token in value:
            score += 3

    for token in weak_avoid:
        if token in value:
            score -= 5

    try:
        if parsed.path in ('/', ''):
            score += 2
    except Exception:
        pass

    return score


def find_contact_page_urls(html: str, base_url: str) -> list[str]:
    """
    Find URLs that are likely contact/about pages from HTML.
    """
    try:
        base_domain = urlparse(base_url).hostname or ''
        base_domain = re.sub(r'^www\.', '', base_domain, flags=re.IGNORECASE)
    except Exception:
        return []

    urls = []
    href_pattern = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
    for match in href_pattern.finditer(html):
        href = match.group(1)
        text = ''  # We don't have anchor text in raw HTML regex

        combined = f'{href} {text}'.lower()
        if not re.search(r'contact|about|connect|reach|team|location', combined, re.IGNORECASE):
            continue

        try:
            abs_url = urljoin(base_url, href)
            domain = urlparse(abs_url).hostname or ''
            domain = re.sub(r'^www\.', '', domain, flags=re.IGNORECASE)
            if domain == base_domain and abs_url not in urls:
                urls.append(abs_url)
        except Exception:
            pass

    return urls


def unique_matches(values: list[str]) -> list[str]:
    """Deduplicate a list preserving order."""
    seen = set()
    result = []
    for v in values:
        v = v.strip()
        if v and v not in seen:
            seen.add(v)
            result.append(v)
    return result
