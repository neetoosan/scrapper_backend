# Google Maps Scraper — Full Architectural Rewrite (Scrap.io Model)

## Problem

The current scraper produces **garbage output**. The root cause: it uses 5+ fragile "strategies" (aria-label mining, live text parsing, data-item parsing, network interception, regex fallbacks) that all fight each other and produce duplicated, misaligned rows in the Excel file. Phone numbers end up on the wrong business. Names are duplicated. The architecture is fundamentally broken.

## How Scrap.io Actually Works

After thorough research, Scrap.io Maps Connect uses a simple, reliable 2-phase approach:

### Phase 1: Read the Visible Results List
- As the user searches Google Maps, the extension reads the **results feed** panel
- For each business card in the feed, it extracts: **Name**, **Rating**, **Review Count**, **Category**, **Address** (partial), and the **place URL**
- It scrolls the feed to load more results
- **Key insight**: It reads from the rendered DOM — one card at a time, cleanly

### Phase 2: Enrich Each Business via Its Place Page
- For each business, it visits the **individual place URL** (either by fetching in background, or by reading the detail panel)
- From the detail panel / fetched page, it extracts: **Phone**, **Website**, **Full Address**, **Hours**
- Then it visits the **business website** (via background fetch) to extract: **Emails**, **Social Media** (Facebook, Instagram, Twitter/X, LinkedIn)

### The Result
Each row in the export = **one business**, with clean columns:
| Name | Category | Rating | Reviews | Phone | Website | Email | Address | Facebook | Instagram | Twitter |

---

## Proposed Architecture (Complete Rewrite)

> [!IMPORTANT]
> This rewrites the entire Google Maps scraping pipeline. The generic website scraper in `popup.js`/`scraper.js` for non-Maps pages will be preserved. Only the Google Maps flow changes.

### Core Principle: **One Business = One Clean Object**

Instead of 5 competing strategies that produce overlapping partial data, we use a **single, deterministic pipeline**:

```
Scroll Feed → Collect Card Data → Deep Fetch Each Place URL → Enrich via Website → Export
```

---

## Proposed Changes

### Phase 1: New Google Maps Scraper Engine

#### [NEW] `gmaps-scraper.js` (~400 lines)
A clean, focused Google Maps scraper replacing the 1700+ lines of Maps-specific code in `scraper.js`. Architecture:

```javascript
// The single data model for a business
{
  name: "",           // From card aria-label or h1
  category: "",       // "Restaurant", "Hotel", etc.
  rating: "",         // "4.5"
  reviewCount: "",    // "1,234"  
  phone: "",          // From detail panel data-item-id="phone:..."
  website: "",        // From detail panel data-item-id="authority:..."
  address: "",        // From detail panel data-item-id="address:..."
  hours: "",          // From detail panel
  email: "",          // From website crawl
  facebook: "",       // From website crawl
  instagram: "",      // From website crawl
  twitter: "",        // From website crawl
  linkedin: "",       // From website crawl
  placeUrl: "",       // Google Maps URL for this business
  placeId: ""         // Google Place ID (from URL)
}
```

**Key functions:**
1. `scrollAndCollectCards()` — Scrolls the feed, collects all `a[href*="/maps/place/"]` cards. For each card, extracts name (from `aria-label`), rating, review count, category from the card's visible text. Returns an array of partial business objects.

2. `fetchPlaceDetails(placeUrl)` — Sends the place URL to `background.js` for fetching. Parses the returned HTML for phone, website, full address, and hours using:
   - `data-item-id="phone:..."` patterns in the HTML
   - Meta description parsing
   - Structured JSON arrays embedded in the page (reusing the existing `parseGoogleMapsStructuredResponse`)

3. `fetchWebsiteContacts(websiteUrl)` — Sends the business website URL to `background.js`. Scans homepage HTML for emails and social links. If not found, discovers and fetches the `/contact` or `/about` page. Returns `{ email, facebook, instagram, twitter, linkedin }`.

4. `scrapeGoogleMaps(options)` — The orchestrator. Calls the above in sequence, updates the UI widget with live progress, returns the final clean array.

---

#### [MODIFY] `gmaps-ui.js`
- Remove the inline email scanning logic (moves into `gmaps-scraper.js`)
- Call `scrapeGoogleMaps()` from the new engine
- Show live progress: "Collecting listings... (32 found)" → "Fetching details 12/32..." → "Scanning websites 12/32..." → "Done! 32 businesses found"
- Add a **progress bar** to the widget
- Show per-business stats: Names, Phones found, Emails found, Websites found

---

#### [MODIFY] `gmaps-ui.css`
- Add styles for the progress bar
- Minor polish

---

#### [MODIFY] `excel-builder.js`  
- Update `buildListingRows()` to use the new flat field names (`phone` instead of `phoneNumbers` array, `email` instead of `emails` array, separate social columns)
- Output columns: **Name | Category | Rating | Reviews | Phone | Website | Email | Address | Hours | Facebook | Instagram | Twitter | LinkedIn | Google Maps URL**

---

#### [MODIFY] `manifest.json`
- Add `gmaps-scraper.js` to the Google Maps content scripts

---

#### [MODIFY] `scraper.js`
- **Remove** all 1700+ lines of Google Maps-specific functions (everything from `isGoogleMapsPage` through `isPlausibleGoogleMapsBusinessName`)  
- Keep only the generic website scraper functions (used by popup.js for non-Maps pages)
- The `scrapeGoogleMapsPage` function is replaced by the new `scrapeGoogleMaps` in `gmaps-scraper.js`

---

#### [MODIFY] `background.js`
- Add rate limiting (100ms delay between fetches) to avoid triggering Google's anti-bot
- Add a timeout (10 seconds per request)
- Add error handling for failed fetches

---

### Phase 2: Excel Output Quality

The new `buildListingRows()` will produce this exact output:

| Name | Category | Rating | Reviews | Phone | Website | Email | Address | Hours | Facebook | Instagram | Twitter | LinkedIn | Maps URL |
|------|----------|--------|---------|-------|---------|-------|---------|-------|----------|-----------|---------|----------|----------|
| Joe's Pizza | Pizza restaurant | 4.5 | 1,234 | (212) 555-0123 | joespizza.com | info@joespizza.com | 7 Carmine St, New York, NY 10014 | Open · Closes 11PM | facebook.com/joespizza | instagram.com/joespizza | | | https://maps.google.com/... |

**Each row = exactly one business. No duplicates. No misaligned data.**

---

## Open Questions

> [!IMPORTANT]
> **Place detail fetching**: The background `fetch()` of Google Maps place URLs returns server-rendered HTML that contains embedded JSON data arrays with phone/website/address. This is the same data format our existing `parseGoogleMapsStructuredResponse` parser handles. However, if Google changes their server-rendered format, we may need to fall back to regex extraction. Should I implement both strategies in the new engine?

> [!NOTE]  
> **Preserving generic scraper**: The non-Maps scraping (for Jiji, Yellow Pages, Facebook, generic websites) in `scraper.js` and `popup.js` will be **completely untouched**. Only the Google Maps pipeline is being rewritten.

## Verification Plan

### Automated Tests
1. `node -c gmaps-scraper.js` — syntax validation
2. `node -c excel-builder.js` — syntax validation  
3. `node -c scraper.js` — verify generic scraper still valid after Maps code removal

### Manual Verification
1. Load extension in Edge
2. Search "restaurants in New York City" on Google Maps
3. Click Start Scraping with Deep Scrape enabled
4. Verify: progress bar shows live updates
5. Export XLSX and verify:
   - Each row = one unique business
   - Phone numbers are in the Phone column
   - Emails are in the Email column  
   - No garbage/duplicated rows
   - Social media links in separate columns
