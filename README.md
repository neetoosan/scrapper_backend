# Edge Contact Scraper

This is a Microsoft Edge browser extension that extracts likely contact information from the current page:

- Name of person
- Company name
- Phone numbers
- WhatsApp numbers when linked on the page
- Social media handles
- Email addresses

## What it does

The extension opens from the Edge toolbar, scans the active tab, shows a JSON result with a quick summary, and can export the extracted data to an `.xlsx` file. It uses page text, headings, metadata, and links to infer contact details.

It now supports two modes:

- `Scrape This Page` for the current page only
- `Scrape Website` for a small same-domain crawl of likely pages such as Contact, About, Team, and Company

## Files

- `manifest.json` - Extension manifest for Chromium/Edge
- `popup.html` - Popup layout
- `popup.css` - Popup styling
- `popup.js` - UI logic and page extraction logic

## Export

- Click **Export XLSX** after scraping a page.
- The extension downloads a spreadsheet with page details and the extracted contact columns.
- For website crawls, the spreadsheet includes one row per scanned page and its extracted contact data.

## Load it in Edge

1. Open `edge://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Notes

- Website crawling is limited to a small set of likely internal pages on the same domain.
- Results are heuristic, so some pages will produce partial or noisy data.
- WhatsApp numbers are only found when a page includes WhatsApp links such as `wa.me` or `whatsapp.com`.
