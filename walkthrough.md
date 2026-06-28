# Google Maps Scraper — Architectural Rewrite Walkthrough

## What Changed

Complete rewrite of the Google Maps scraping pipeline, modeled after Scrap.io Maps Connect. Replaced the broken 5-strategy architecture with a clean 3-phase pipeline.

## Architecture: Before vs After

### Before (Broken)
```
5 competing strategies → overlapping partial data → misaligned Excel rows
  - Network interception
  - Aria-label mining
  - Live text parsing
  - Detail panel parsing
  - Data-item-id extraction
  - Card clicking (navigated/refreshed page)
```

### After (Scrap.io Model)
```
Phase 1: Scroll feed → Collect business cards (name, rating, category, placeUrl)
Phase 2: Fetch each place URL via background worker → Extract phone, website, address, hours
Phase 3: Fetch each business website → Extract email, Facebook, Instagram, Twitter, LinkedIn
```

**Each business = one flat object. One row in Excel. No duplicates. No misalignment.**

## Files Changed

### [NEW] [gmaps-scraper.js](file:///c:/Users/HP/Documents/work/edgewebscraper/gmaps-scraper.js)
The new core engine (~350 lines). Contains:
- `scrollAndCollectCards()` — scrolls feed, collects cards with name/rating/category
- `fetchPlaceDetails()` — fetches place page HTML via background worker, extracts phone/website/address/hours
- `fetchWebsiteContacts()` — fetches business website + contact pages, extracts emails and social links
- `scrapeGoogleMaps()` — orchestrator with live progress callbacks

### [REWRITE] [gmaps-ui.js](file:///c:/Users/HP/Documents/work/edgewebscraper/gmaps-ui.js)
Complete rewrite (~170 lines). Now:
- Calls `window.scrapeGoogleMaps()` from the new engine
- Shows live progress bar with phase labels
- Shows 5 stat cards: Total, Phones, Emails, Websites, Socials
- Uses `buildGoogleMapsWorkbook()` for clean XLSX export

### [REWRITE] [gmaps-ui.css](file:///c:/Users/HP/Documents/work/edgewebscraper/gmaps-ui.css)
Complete rewrite with:
- Progress bar with gradient animation
- Improved stat cards layout (5 columns)
- Stop button styling
- Polished dark theme matching Google's design

### [MODIFY] [excel-builder.js](file:///c:/Users/HP/Documents/work/edgewebscraper/excel-builder.js)
Added `buildGoogleMapsWorkbook(businesses, pageTitle)` and `buildGoogleMapsRows()`:
- Clean columns: Name | Category | Rating | Reviews | Phone | Website | Email | Address | Hours | Facebook | Instagram | Twitter | LinkedIn | Maps URL
- One business per row
- Includes XLSX styles with bold header font
- Legacy `buildWorkbook()` preserved for generic scraper

### [REWRITE] [background.js](file:///c:/Users/HP/Documents/work/edgewebscraper/background.js)
- Added rate limiting (150ms between requests)
- Added 10-second timeout per request via AbortController
- Better error handling

### [MODIFY] [manifest.json](file:///c:/Users/HP/Documents/work/edgewebscraper/manifest.json)
- Added `excel-builder.js` and `gmaps-scraper.js` to Google Maps content scripts

### [MODIFY] [scraper.js](file:///c:/Users/HP/Documents/work/edgewebscraper/scraper.js)
- Removed over 1,300 lines of dead, obsolete Google Maps scraping, network interception, and structured parsing code.
- Updated `scrapePage` to return a friendly redirection error when trying to scrape Google Maps pages from the standard popup, guiding users to use the upgraded dedicated widget instead.

### [NEW] [RENDER_DEPLOYMENT.md](file:///c:/Users/HP/Documents/work/edgewebscraper/RENDER_DEPLOYMENT.md)
Comprehensive step-by-step guide for deploying the Scrapy + FastAPI backend to Render via Blueprint or Web Service.

### [NEW] [render.yaml](file:///c:/Users/HP/Documents/work/edgewebscraper/render.yaml) & [backend/render.yaml](file:///c:/Users/HP/Documents/work/edgewebscraper/backend/render.yaml)
Render Blueprint deployment specification files for 1-click cloud setup.

### [MODIFY] [backend/config.py](file:///c:/Users/HP/Documents/work/edgewebscraper/backend/config.py)
Updated `API_PORT` to dynamically inspect the `PORT` environment variable injected by cloud providers like Render.

### [MODIFY] [backend/Dockerfile](file:///c:/Users/HP/Documents/work/edgewebscraper/backend/Dockerfile)
Updated `HEALTHCHECK` and `CMD` to enable shell variable expansion for dynamic port binding `${PORT:-8000}`.

### [MODIFY] [popup.html](file:///c:/Users/HP/Documents/work/edgewebscraper/popup.html), [popup.css](file:///c:/Users/HP/Documents/work/edgewebscraper/popup.css), & [popup.js](file:///c:/Users/HP/Documents/work/edgewebscraper/popup.js)
Added a **Scrape Engine** mode selector (`🌐 Cloud Server (Render Scrapy)` vs `💻 Local Browser`). Connected the popup UI to communicate with `https://edgewebscraper-backend.onrender.com` for cloud-based scraping and multi-page site crawling.

### [MODIFY] [backend/scraper/settings.py](file:///c:/Users/HP/Documents/work/edgewebscraper/backend/scraper/settings.py) & [backend/runner.py](file:///c:/Users/HP/Documents/work/edgewebscraper/backend/runner.py)
Fixed Linux reactor mismatch error (`EPollReactor` vs `AsyncioSelectorReactor`) by setting `TWISTED_REACTOR = None` so Scrapy seamlessly reuses Crochet's pre-initialized Linux event loop on Render.

---

## Data Flow

```
User clicks "Start Scraping"
  → gmaps-ui.js calls scrapeGoogleMaps(options, callbacks)
    → Phase 1: scrollAndCollectCards()
      → Scrolls [role="feed"] container
      → Collects a[href*="/maps/place/"] cards
      → Returns [{name, category, rating, reviewCount, placeUrl}]
    → Phase 2: fetchPlaceDetails() for each business
      → chrome.runtime.sendMessage → background.js → fetch(placeUrl)
      → Parse HTML for phone (data-item-id, tel: links), website, address, hours
    → Phase 3: fetchWebsiteContacts() for each business with website
      → fetch homepage → extract emails + socials
      → discover /contact or /about pages → fetch those too
  → gmaps-ui.js receives flat business array
  → User clicks "Export XLSX"
    → buildGoogleMapsWorkbook(businesses) → clean XLSX download
```

## Verification

- ✅ All 6 JS files pass `node -c` syntax validation
- ✅ `manifest.json` passes JSON validation
- ✅ Backend configuration updated for Render dynamic `$PORT` handling
- ✅ Created `render.yaml` and `RENDER_DEPLOYMENT.md`
- ⏳ Manual test: reload extension → search Google Maps → scrape → export XLSX

## How to Test

1. Open `edge://extensions`
2. Click **Reload** on the Edge Contact Scraper extension
3. Navigate to Google Maps
4. Search "restaurants in New York City"
5. Look for the **Edge Maps Scraper** widget (bottom-left)
6. Click **Start Scraping**
7. Watch the progress bar and live stats
8. Click **Export XLSX** when done
9. Open the XLSX — each row should be one clean business with proper columns

