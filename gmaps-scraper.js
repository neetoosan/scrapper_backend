// gmaps-scraper.js — Deterministic Google Maps scraper engine
// Pipeline: collect result cards -> fetch place details -> enrich via website -> export flat rows.

(function () {
  "use strict";

  window.scrapeGoogleMaps = scrapeGoogleMaps;

  const REQUEST_DELAY_MS = 150;
  const PLACE_FETCH_TIMEOUT_MS = 6500;
  const WEBSITE_FETCH_TIMEOUT_MS = 8000;
  const PLACE_DETAIL_CONCURRENCY = 1;
  const WEBSITE_SCAN_CONCURRENCY = 2;
  const MAX_SCROLL_ITERATIONS = 80;
  const CARD_SELECTOR = 'a[href*="/maps/place/"]';
  const EXCLUDED_WEBSITE_HOSTS =
    /(^|\.)google\.|gstatic|youtube|googleapis|ggpht|googleusercontent|schema\.org|w3\.org|apple\.com|microsoft\.com|cloudflare|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com/i;

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (isCancelled(signal)) {
        reject(new Error("Scraping stopped."));
        return;
      }
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.onCancel = function () {
          clearTimeout(timer);
          reject(new Error("Scraping stopped."));
        };
      }
    });
  }

  function isCancelled(signal) {
    return Boolean(signal && signal.cancelled);
  }

  function assertNotCancelled(signal) {
    if (isCancelled(signal)) {
      throw new Error("Scraping stopped.");
    }
  }

  async function sendToBackground(url, signal, timeoutMs) {
    assertNotCancelled(signal);
    if (!url) return null;

    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ success: false, error: "Request timed out" });
      }, timeoutMs || WEBSITE_FETCH_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({ action: "fetchWebsite", url }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError || isCancelled(signal)) {
            resolve(null);
            return;
          }
          resolve(resp || null);
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\\u003d/g, "=")
      .replace(/\\u0026/g, "&")
      .replace(/\\u002F/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePhone(value) {
    const cleaned = normalizeText(value)
      .replace(/^Phone:\s*/i, "")
      .replace(/^tel:/i, "")
      .trim();
    const digitCount = (cleaned.match(/\d/g) || []).length;
    return digitCount >= 7 && digitCount <= 15 ? cleaned : "";
  }

  function absoluteUrl(url, baseUrl) {
    try {
      return new URL(url, baseUrl || location.href).href;
    } catch (e) {
      return "";
    }
  }

  function unwrapGoogleUrl(url) {
    try {
      const parsed = new URL(normalizeText(url), location.href);
      const nested = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      if (nested && /^https?:\/\//i.test(nested)) {
        return nested;
      }
      return parsed.href;
    } catch (e) {
      return "";
    }
  }

  function canonicalPlaceUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.hash = "";
      parsed.search = "";
      return parsed.href.replace(/\/$/, "");
    } catch (e) {
      return normalizeText(url).split("?")[0].replace(/\/$/, "");
    }
  }

  function extractPlaceId(url) {
    const decoded = decodeURIComponent(String(url || ""));
    const patterns = [
      /[?&]place_id=([^&]+)/i,
      /[?&]cid=([^&]+)/i,
      /!1s([^!]+)/i,
      /data=[^#?]*!1s([^!]+)/i,
    ];

    for (const pattern of patterns) {
      const match = decoded.match(pattern);
      if (match && match[1]) {
        return normalizeText(match[1]);
      }
    }

    const placePath = decoded.match(/\/maps\/place\/([^/@?#]+)/i);
    return placePath ? normalizeText(placePath[1]).replace(/\+/g, " ") : "";
  }

  function parseHtml(html) {
    try {
      return new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return null;
    }
  }

  async function waitFor(predicate, timeoutMs, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      assertNotCancelled(signal);
      const value = predicate();
      if (value) return value;
      await sleep(250, signal);
    }
    return null;
  }

  function findFeedContainer() {
    const feed = document.querySelector('[role="feed"]');
    if (feed) return feed;

    return (
      Array.from(document.querySelectorAll("div")).find((el) => {
        const style = window.getComputedStyle(el);
        return (
          /(auto|scroll)/.test(style.overflowY || "") &&
          el.scrollHeight > el.clientHeight + 200 &&
          el.querySelector(CARD_SELECTOR)
        );
      }) || null
    );
  }

  function findCardContainer(anchor) {
    let current = anchor;
    let best = anchor;

    for (let depth = 0; depth < 8 && current.parentElement; depth++) {
      current = current.parentElement;
      const text = normalizeText(current.textContent);
      if (
        text.length > normalizeText(best.textContent).length &&
        text.length < 2500 &&
        current.querySelector(CARD_SELECTOR)
      ) {
        best = current;
      }
    }

    return best;
  }

  function findAnchorForBusiness(business) {
    const anchors = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const canonicalUrl = canonicalPlaceUrl(business.placeUrl);
    const expectedName = normalizeText(business.name).toLowerCase();

    return (
      anchors.find((anchor) => canonicalPlaceUrl(anchor.href) === canonicalUrl && anchor.offsetParent) ||
      anchors.find((anchor) => {
        const label = normalizeText(anchor.getAttribute("aria-label") || anchor.textContent).toLowerCase();
        return anchor.offsetParent && expectedName && label.includes(expectedName.slice(0, 24));
      }) ||
      null
    );
  }

  async function findAnchorForBusinessByScrolling(business, signal) {
    let anchor = findAnchorForBusiness(business);
    if (anchor) return anchor;

    const feed = findFeedContainer();
    if (!feed) return null;

    const originalTop = feed.scrollTop;
    feed.scrollTop = 0;
    await sleep(350, signal);

    for (let attempt = 0; attempt < 18; attempt++) {
      assertNotCancelled(signal);
      anchor = findAnchorForBusiness(business);
      if (anchor) return anchor;

      feed.scrollBy(0, 650);
      await sleep(350, signal);
    }

    feed.scrollTop = originalTop;
    await sleep(200, signal);
    return findAnchorForBusiness(business);
  }

  function extractRatingAndReviews(text) {
    const match =
      text.match(/(?:^|\s)([1-5]\.\d)\s*\(?\s*([0-9][0-9,.\s]*)\s*(?:reviews?)?\)?/i) ||
      text.match(/([1-5]\.\d)\s+([0-9][0-9,.\s]*)/);

    return {
      rating: match ? normalizeText(match[1]) : "",
      reviewCount: match ? normalizeText(match[2]).replace(/[^\d,]/g, "") : "",
    };
  }

  function splitCardText(text) {
    return normalizeText(text)
      .split(/[·•|]/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function isCategoryCandidate(segment, name) {
    const cleanedSegment = cleanCategory(segment);
    return (
      cleanedSegment.length > 2 &&
      cleanedSegment.length < 70 &&
      !/^\d/.test(cleanedSegment) &&
      !/^\$/.test(cleanedSegment) &&
      !/(Open|Closed|Closes|Opens|hours|Dine-in|Takeout|Delivery|No dine|reviews?|stars?|Located in)/i.test(cleanedSegment) &&
      !cleanedSegment.toLowerCase().includes(name.toLowerCase().slice(0, 12))
    );
  }

  function cleanCategory(segment) {
    return normalizeText(segment)
      .replace(/^(?:₦|NGN|N)\s*[\d,]+(?:\s*[–-]\s*(?:₦|NGN|N)?\s*[\d,]+|\+)?\s*/i, "")
      .replace(/^(?:[$€£])\s*[\d,]+(?:\s*[–-]\s*(?:[$€£])?\s*[\d,]+|\+)?\s*/i, "")
      .replace(/^[·•|,\s]+/, "")
      .trim();
  }

  function extractCardFields(anchor) {
    const card = findCardContainer(anchor);
    const cardText = normalizeText(card.textContent);
    const name =
      normalizeText(anchor.getAttribute("aria-label")) ||
      normalizeText(anchor.textContent).split(/[·•|]/)[0];
    const segments = splitCardText(cardText);
    const ratingInfo = extractRatingAndReviews(cardText);
    const category = cleanCategory(segments.find((segment) => isCategoryCandidate(segment, name)) || "");
    const partialAddress =
      [...segments]
        .reverse()
        .find((segment) => segment.length > 8 && /\d/.test(segment) && /[A-Za-z]/.test(segment) && /,/.test(segment)) ||
      "";

    return {
      name,
      category,
      rating: ratingInfo.rating,
      reviewCount: ratingInfo.reviewCount,
      address: partialAddress,
    };
  }

  async function scrollFeed(container, maxResults, onStatus, signal) {
    const iterations =
      maxResults === 0
        ? MAX_SCROLL_ITERATIONS
        : Math.min(MAX_SCROLL_ITERATIONS, Math.max(4, Math.ceil(maxResults / 5)));
    let lastTop = -1;
    let stale = 0;

    for (let index = 0; index < iterations && stale < 5; index++) {
      assertNotCancelled(signal);
      container.scrollBy(0, 900);
      await sleep(900, signal);

      if (Math.abs(container.scrollTop - lastTop) < 2) {
        stale++;
        if (stale < 5) await sleep(500, signal);
      } else {
        stale = 0;
      }

      lastTop = container.scrollTop;
      onStatus("Scrolling... " + collectCardsFromFeed().length + " unique businesses loaded");
    }
  }

  function collectCardsFromFeed() {
    const anchors = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const businesses = [];
    const seenKeys = new Set();

    for (const anchor of anchors) {
      if (!anchor.offsetParent) continue;

      const fields = extractCardFields(anchor);
      if (!fields.name || fields.name.length < 2 || fields.name.length > 140) continue;

      const placeUrl = canonicalPlaceUrl(anchor.href);
      const placeId = extractPlaceId(anchor.href);
      const key = placeId || placeUrl || fields.name.toLowerCase() + "|" + fields.address.toLowerCase();
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);

      businesses.push({
        name: fields.name,
        category: fields.category,
        rating: fields.rating,
        reviewCount: fields.reviewCount,
        phone: "",
        website: "",
        email: "",
        address: fields.address,
        hours: "",
        facebook: "",
        instagram: "",
        twitter: "",
        linkedin: "",
        placeUrl,
        placeId,
      });
    }

    return businesses;
  }

  async function scrollAndCollectCards(options, onStatus, signal) {
    onStatus("Finding results feed...");
    const container = findFeedContainer();

    if (!container) {
      onStatus("No results feed found. Search for something on Google Maps first.");
      return [];
    }

    const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : 60;
    onStatus("Scrolling to load results...");
    await scrollFeed(container, maxResults, onStatus, signal);

    const businesses = collectCardsFromFeed();
    const limit = maxResults === 0 ? businesses.length : Math.min(maxResults, businesses.length);

    onStatus("Collected " + businesses.length + " unique businesses from feed.");
    return businesses.slice(0, limit);
  }

  function extractTextNearDataItem(html, dataItemPattern, labelPattern) {
    const item = html.match(dataItemPattern);
    if (!item) return "";

    const start = Math.max(0, item.index - 300);
    const end = Math.min(html.length, item.index + 900);
    const section = html.slice(start, end);
    const aria = section.match(labelPattern);
    return aria && aria[1] ? normalizeText(aria[1]) : "";
  }

  function extractWebsiteFromPlaceHtml(html, doc) {
    if (doc) {
      const authorityButton = doc.querySelector('[data-item-id^="authority"]');
      const link =
        (authorityButton && authorityButton.closest("a[href]")) ||
        doc.querySelector('a[data-item-id^="authority"][href]');
      if (link) {
        const unwrapped = unwrapGoogleUrl(link.getAttribute("href"));
        if (isUsableWebsite(unwrapped)) return normalizedWebsite(unwrapped);
      }
    }

    const cleanHtml = html
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003d/gi, "=")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/");

    const authorityMatch = cleanHtml.match(/data-item-id=["']authority[^"']*["'][\s\S]{0,900}?href=["']([^"']+)["']/i);
    if (authorityMatch) {
      const unwrapped = unwrapGoogleUrl(authorityMatch[1]);
      if (isUsableWebsite(unwrapped)) return normalizedWebsite(unwrapped);
    }

    // Match URLs and exclude escaped characters like \\/ by matching slashes correctly
    const urls = cleanHtml.match(/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>\\\/]*)?/gi) || [];
    for (const url of urls) {
      const unwrapped = unwrapGoogleUrl(url);
      if (isUsableWebsite(unwrapped)) return normalizedWebsite(unwrapped);
    }

    return "";
  }

  function isUsableWebsite(url) {
    try {
      const parsed = new URL(url);
      return /^https?:$/i.test(parsed.protocol) && !EXCLUDED_WEBSITE_HOSTS.test(parsed.hostname);
    } catch (e) {
      return false;
    }
  }

  function normalizedWebsite(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.href.replace(/\/$/, "");
    } catch (e) {
      return "";
    }
  }

  function extractAddressFromPlaceHtml(html, doc) {
    if (doc) {
      const addressNode = doc.querySelector('[data-item-id^="address"]');
      const label = addressNode && addressNode.getAttribute("aria-label");
      if (label) return normalizeText(label).replace(/^Address:\s*/i, "");
    }

    const cleanHtml = html
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003d/gi, "=")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/");

    const dataAddress = extractTextNearDataItem(
      cleanHtml,
      /data-item-id=["']address[^"']*["']/i,
      /aria-label=["']([^"']+)["']/i
    ).replace(/^Address:\s*/i, "");
    if (dataAddress) return dataAddress;

    const meta = cleanHtml.match(/<meta[^>]*(?:name=["']description["'][^>]*content|content)=["']([^"']+)["'][^>]*>/i);
    if (meta && meta[1]) {
      const parts = normalizeText(meta[1]).split(/[·•|]/).map(normalizeText);
      const address = [...parts]
        .reverse()
        .find((part) => part.length > 10 && /\d/.test(part) && /[A-Za-z]/.test(part) && /,/.test(part));
      if (address) return address;
    }

    return "";
  }

  function extractPhoneFromPlaceHtml(html, doc) {
    if (doc) {
      const phoneNode = doc.querySelector('[data-item-id^="phone:"]');
      if (phoneNode) {
        const fromId = phoneNode.getAttribute("data-item-id").replace(/^phone:(?:tel:)?/i, "");
        const fromLabel = phoneNode.getAttribute("aria-label");
        const phone = normalizePhone(fromLabel || fromId);
        if (phone) return phone;
      }

      const telLink = doc.querySelector('a[href^="tel:"]');
      if (telLink) {
        const phone = normalizePhone(telLink.getAttribute("href"));
        if (phone) return phone;
      }
    }

    const cleanHtml = html
      .replace(/\\u002f/gi, "/")
      .replace(/\\u003d/gi, "=")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/");

    const telMatch = cleanHtml.match(/tel:(\+?[0-9\s.\-()]{7,20})/i);
    if (telMatch) {
      const phone = normalizePhone(telMatch[1]);
      if (phone) return phone;
    }

    const phoneAttr = cleanHtml.match(/data-item-id=["']phone:(?:tel:)?([^"']+)["']/i);
    if (phoneAttr && phoneAttr[1]) {
      const phone = normalizePhone(decodeURIComponent(phoneAttr[1]));
      if (phone) return phone;
    }

    const telHref = cleanHtml.match(/href=["']tel:([^"']+)["']/i);
    if (telHref && telHref[1]) {
      const phone = normalizePhone(decodeURIComponent(telHref[1]));
      if (phone) return phone;
    }

    const contextualPhone = extractTextNearDataItem(
      cleanHtml,
      /(?:phone|telephone|tel:)/i,
      /(\+?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?)/i
    );
    return normalizePhone(contextualPhone);
  }

  function extractHoursFromPlaceHtml(html, doc) {
    if (doc) {
      const hourLabels = Array.from(doc.querySelectorAll('[aria-label*="Open"], [aria-label*="Closed"], [aria-label*="hours"]'))
        .map((node) => normalizeText(node.getAttribute("aria-label")))
        .filter(Boolean);
      const useful = hourLabels.find((label) => /(Open|Closed|hours)/i.test(label));
      if (useful) return useful;
    }

    const text = normalizeText(html);
    const match =
      text.match(/(Open\s*[·•⋅]\s*Closes\s+\d{1,2}(?::\d{2})?\s*[AP]M)/i) ||
      text.match(/(Closed\s*[·•⋅]\s*Opens\s+\w+\s+\d{1,2}(?::\d{2})?\s*[AP]M)/i) ||
      text.match(/(Open 24 hours)/i);
    return match ? normalizeText(match[1]) : "";
  }

  function extractLivePanelDetails(business) {
    const details = {
      name: "",
      phone: "",
      website: "",
      address: "",
      hours: "",
    };

    const heading = document.querySelector("h1");
    if (heading) details.name = normalizeText(heading.textContent);

    const phoneNode = document.querySelector('[data-item-id^="phone:"]');
    if (phoneNode) {
      const fromId = phoneNode.getAttribute("data-item-id").replace(/^phone:(?:tel:)?/i, "");
      details.phone = normalizePhone(phoneNode.getAttribute("aria-label") || fromId);
    }

    if (!details.phone) {
      const telLink = document.querySelector('a[href^="tel:"]');
      if (telLink) details.phone = normalizePhone(telLink.getAttribute("href"));
    }

    if (!details.phone) {
      const phoneButton = Array.from(document.querySelectorAll("button[aria-label], a[aria-label]")).find((node) => {
        const label = normalizeText(node.getAttribute("aria-label"));
        return /(?:phone|call|telephone|mobile|contact)/i.test(label) && /\d/.test(label);
      });
      if (phoneButton) {
        details.phone = normalizePhone(phoneButton.getAttribute("aria-label"));
      }
    }

    const websiteNode =
      document.querySelector('a[data-item-id^="authority"][href]') ||
      (document.querySelector('[data-item-id^="authority"]') &&
        document.querySelector('[data-item-id^="authority"]').closest("a[href]"));
    if (websiteNode) {
      const website = unwrapGoogleUrl(websiteNode.getAttribute("href"));
      if (isUsableWebsite(website)) details.website = normalizedWebsite(website);
    }

    const addressNode = document.querySelector('[data-item-id^="address"]');
    if (addressNode) {
      details.address = normalizeText(addressNode.getAttribute("aria-label")).replace(/^Address:\s*/i, "");
    }

    const hoursNode =
      document.querySelector('[aria-label*="Open ⋅"], [aria-label*="Closed ⋅"], [aria-label*="Open ·"], [aria-label*="Closed ·"], [aria-label*="Open 24 hours"]') ||
      Array.from(document.querySelectorAll("button, div, span")).find((node) =>
        /^(Open|Closed)(\s*[·•⋅]\s*|\s+24)/i.test(normalizeText(node.textContent))
      );
    if (hoursNode) {
      details.hours = normalizeText(hoursNode.getAttribute("aria-label") || hoursNode.textContent);
    }

    if (!details.website) {
      const links = Array.from(document.querySelectorAll('a[href^="http"]'));
      const websiteLink = links
        .map((link) => unwrapGoogleUrl(link.getAttribute("href")))
        .find((url) => isUsableWebsite(url));
      if (websiteLink) details.website = normalizedWebsite(websiteLink);
    }

    if (!details.phone) {
      const panel =
        document.querySelector('[role="main"]') ||
        document.querySelector('[aria-label*="Information"]') ||
        document.body;
      const visibleText = normalizeText(panel.textContent);
      const match = visibleText.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/);
      if (match) details.phone = normalizePhone(match[0]);
    }

    if (details.name && business.name && !details.name.toLowerCase().includes(business.name.toLowerCase().slice(0, 12))) {
      details.name = "";
    }

    return details;
  }

  function applyDetails(business, details) {
    if (!details) return;
    if (!business.name && details.name) business.name = details.name;
    if (!business.phone && details.phone) business.phone = details.phone;
    if (!business.website && details.website) business.website = details.website;
    if (!business.address && details.address) business.address = details.address;
    if (!business.hours && details.hours) business.hours = details.hours;
  }

  function mergeDetails(target, source) {
    if (!source) return target;
    if (!target.name && source.name) target.name = source.name;
    if (!target.phone && source.phone) target.phone = source.phone;
    if (!target.website && source.website) target.website = source.website;
    if (!target.address && source.address) target.address = source.address;
    if (!target.hours && source.hours) target.hours = source.hours;
    return target;
  }

  function findBackButton() {
    const selectors = [
      'button[aria-label="Back"]',
      'button[aria-label^="Back"]',
      'button[jsaction*="pane.place.back"]',
      'button[jsaction*="back"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && button.offsetParent) return button;
    }

    return Array.from(document.querySelectorAll("button")).find((button) =>
      /^Back$/i.test(normalizeText(button.getAttribute("aria-label") || button.textContent))
    );
  }

  async function returnToResults(signal) {
    const backButton = findBackButton();
    if (!backButton) return false;

    backButton.click();
    await waitFor(function () {
      return findFeedContainer() && document.querySelector(CARD_SELECTOR);
    }, 5000, signal);
    await sleep(300, signal);
    return true;
  }

  async function fetchPlaceDetailsFromPanel(business, signal) {
    const anchor = await findAnchorForBusinessByScrolling(business, signal);
    if (!anchor) return false;

    anchor.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(200, signal);
    anchor.click();

    await waitFor(function () {
      const heading = normalizeText(document.querySelector("h1") && document.querySelector("h1").textContent);
      return heading && heading.toLowerCase().includes(business.name.toLowerCase().slice(0, 12));
    }, 5000, signal);

    const bestDetails = {};
    const loaded = await waitFor(function () {
      const details = extractLivePanelDetails(business);
      mergeDetails(bestDetails, details);
      return details.phone || (details.website && details.address);
    }, 8500, signal);

    if (!loaded) {
      const details = extractLivePanelDetails(business);
      mergeDetails(bestDetails, details);
    }

    if (bestDetails.phone || bestDetails.website || bestDetails.address || bestDetails.hours) {
      applyDetails(business, bestDetails);
    }

    await returnToResults(signal);
    return Boolean(bestDetails.phone || bestDetails.website || bestDetails.address || loaded);
  }

  async function fetchPlaceDetails(business, signal) {
    assertNotCancelled(signal);
    const livePanelWorked = await fetchPlaceDetailsFromPanel(business, signal);
    if (livePanelWorked && (business.phone || business.website || business.address)) {
      return business;
    }

    const resp = await sendToBackground(business.placeUrl, signal, PLACE_FETCH_TIMEOUT_MS);
    if (!resp || !resp.success || !resp.html) return business;

    const html = resp.html;
    const doc = parseHtml(html);

    if (!business.placeId) business.placeId = extractPlaceId(business.placeUrl || html);
    if (!business.phone) business.phone = extractPhoneFromPlaceHtml(html, doc);
    if (!business.website) business.website = extractWebsiteFromPlaceHtml(html, doc);
    if (!business.address) business.address = extractAddressFromPlaceHtml(html, doc);
    if (!business.hours) business.hours = extractHoursFromPlaceHtml(html, doc);

    return business;
  }

  function extractEmailsFromHtml(html) {
    const expanded = normalizeText(html)
      .replace(/%40/g, "@")
      .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
      .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
      .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
      .replace(/\s*\(\s*dot\s*\)\s*/gi, ".");
    const mailtoMatches = Array.from(html.matchAll(/mailto:([^"'>?\s]+)/gi)).map((match) =>
      decodeURIComponent(match[1])
    );
    const matches = expanded.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [];
    return [
      ...new Set(
        matches.concat(mailtoMatches).filter((email) => {
          const lowered = email.toLowerCase();
          return (
            lowered.length < 80 &&
            !/\.(png|jpg|jpeg|gif|svg|webp|css|js|pdf|woff2?|ttf|eot|ico|map)$/i.test(lowered) &&
            !/sentry|wixpress|example\.com|webpack|cloudflare|googleapis|gravatar|domain\.com/i.test(lowered) &&
            !lowered.startsWith("u00")
          );
        })
      ),
    ];
  }

  function extractSocialLinks(html) {
    const socials = { facebook: "", instagram: "", twitter: "", linkedin: "" };
    const text = normalizeText(html);
    const patterns = {
      facebook: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|login|plugins|watch|photo|groups\/\d)([a-zA-Z0-9._-]+)/i,
      instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|tags|accounts|about|developer|legal|reel)([a-zA-Z0-9._]+)/i,
      twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|login|signup|i\/web)([a-zA-Z0-9_]+)/i,
      linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._-]+)/i,
    };

    const fb = text.match(patterns.facebook);
    if (fb) socials.facebook = "https://facebook.com/" + fb[1];

    const ig = text.match(patterns.instagram);
    if (ig) socials.instagram = "https://instagram.com/" + ig[1];

    const tw = text.match(patterns.twitter);
    if (tw) socials.twitter = "https://x.com/" + tw[1];

    const li = text.match(patterns.linkedin);
    if (li) socials.linkedin = li[0].split("?")[0];

    return socials;
  }

  function mergeSocials(target, source) {
    if (!target.facebook && source.facebook) target.facebook = source.facebook;
    if (!target.instagram && source.instagram) target.instagram = source.instagram;
    if (!target.twitter && source.twitter) target.twitter = source.twitter;
    if (!target.linkedin && source.linkedin) target.linkedin = source.linkedin;
  }

  function findContactPageUrls(html, baseUrl) {
    const doc = parseHtml(html);
    if (!doc) return [];

    const urls = [];
    let baseDomain = "";
    try {
      baseDomain = new URL(baseUrl).hostname.replace(/^www\./i, "");
    } catch (e) {
      return [];
    }

    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = normalizeText(anchor.getAttribute("href"));
      const text = normalizeText(anchor.textContent).toLowerCase();
      if (!/(contact|about|connect|reach|team|location)/i.test(href + " " + text)) continue;

      const abs = absoluteUrl(href, baseUrl);
      if (!abs) continue;

      try {
        const domain = new URL(abs).hostname.replace(/^www\./i, "");
        if (domain === baseDomain && !urls.includes(abs)) {
          urls.push(abs);
        }
      } catch (e) {}
    }

    return urls.slice(0, 3);
  }

  async function fetchWebsiteContacts(business, signal) {
    assertNotCancelled(signal);
    if (!business.website) return business;

    const resp = await sendToBackground(business.website, signal, WEBSITE_FETCH_TIMEOUT_MS);
    if (!resp || !resp.success || !resp.html) return business;

    let emails = extractEmailsFromHtml(resp.html);
    const socials = extractSocialLinks(resp.html);
    const contactPages = findContactPageUrls(resp.html, business.website);

    for (const pageUrl of contactPages) {
      assertNotCancelled(signal);
      if (emails.length > 0 && socials.facebook && socials.instagram && socials.twitter && socials.linkedin) break;

      await sleep(REQUEST_DELAY_MS, signal);
      const subResp = await sendToBackground(pageUrl, signal, WEBSITE_FETCH_TIMEOUT_MS);
      if (!subResp || !subResp.success || !subResp.html) continue;

      emails = emails.concat(extractEmailsFromHtml(subResp.html));
      mergeSocials(socials, extractSocialLinks(subResp.html));
    }

    business.email = [...new Set(emails)][0] || business.email || "";
    mergeSocials(business, socials);
    return business;
  }

  function computeStats(businesses) {
    return {
      total: businesses.length,
      phones: businesses.filter((business) => business.phone).length,
      emails: businesses.filter((business) => business.email).length,
      websites: businesses.filter((business) => business.website).length,
      socials: businesses.filter(
        (business) => business.facebook || business.instagram || business.twitter || business.linkedin
      ).length,
    };
  }

  function compactUniqueBusinesses(businesses) {
    const byKey = new Map();

    for (const business of businesses) {
      const key =
        business.placeId ||
        business.placeUrl ||
        business.name.toLowerCase() + "|" + business.address.toLowerCase();

      if (!byKey.has(key)) {
        byKey.set(key, business);
        continue;
      }

      const existing = byKey.get(key);
      for (const field of [
        "category",
        "rating",
        "reviewCount",
        "phone",
        "website",
        "email",
        "address",
        "hours",
        "facebook",
        "instagram",
        "twitter",
        "linkedin",
        "placeId",
      ]) {
        if (!existing[field] && business[field]) existing[field] = business[field];
      }
    }

    return Array.from(byKey.values());
  }

  async function runWithConcurrency(items, concurrency, worker) {
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    const runners = [];

    async function runOne() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex++;
        await worker(items[index], index);
      }
    }

    for (let index = 0; index < workerCount; index++) {
      runners.push(runOne());
    }

    await Promise.all(runners);
  }

  async function scrapeGoogleMaps(options, callbacks) {
    const opts = options || {};
    const cb = callbacks || {};
    const signal = opts.signal || null;
    const onStatus = cb.onStatus || function () {};
    const onProgress = cb.onProgress || function () {};
    const onStats = cb.onStats || function () {};
    const onPartial = cb.onPartial || function () {};

    onStatus("Phase 1: Collecting business listings...");
    onProgress(0, "Scrolling...");

    let businesses = await scrollAndCollectCards(opts, onStatus, signal);
    businesses = compactUniqueBusinesses(businesses);

    if (businesses.length === 0) {
      onStatus("No businesses found. Search for something on Google Maps first.");
      return [];
    }

    onStatus("Found " + businesses.length + " unique businesses. Starting enrichment...");
    onStats(computeStats(businesses));
    onPartial(businesses);

    if (opts.deepScrape !== false) {
      onStatus("Phase 2: Fetching business details...");
      let completedDetails = 0;
      await runWithConcurrency(businesses, PLACE_DETAIL_CONCURRENCY, async function (business) {
        assertNotCancelled(signal);
        onProgress(
          (completedDetails / businesses.length) * 50,
          "Details " + (completedDetails + 1) + "/" + businesses.length + ": " + business.name
        );
        await fetchPlaceDetails(business, signal);
        completedDetails++;
        onProgress(
          (completedDetails / businesses.length) * 50,
          "Details " + completedDetails + "/" + businesses.length + " complete"
        );
        onStats(computeStats(businesses));
        onPartial(businesses);
        await sleep(REQUEST_DELAY_MS, signal);
      });
    }

    const withWebsites = businesses.filter((business) => business.website);
    if (withWebsites.length > 0) {
      onStatus("Phase 3: Scanning websites for emails and socials...");
      let completedWebsites = 0;
      await runWithConcurrency(withWebsites, WEBSITE_SCAN_CONCURRENCY, async function (business) {
        assertNotCancelled(signal);
        onProgress(
          50 + (completedWebsites / withWebsites.length) * 50,
          "Website " + (completedWebsites + 1) + "/" + withWebsites.length + ": " + business.name
        );
        await fetchWebsiteContacts(business, signal);
        completedWebsites++;
        onProgress(
          50 + (completedWebsites / withWebsites.length) * 50,
          "Website " + completedWebsites + "/" + withWebsites.length + " complete"
        );
        onStats(computeStats(businesses));
        onPartial(businesses);
        await sleep(REQUEST_DELAY_MS, signal);
      });
    }

    businesses = compactUniqueBusinesses(businesses);
    const finalStats = computeStats(businesses);
    onProgress(100, "Complete!");
    onStats(finalStats);
    onPartial(businesses);
    onStatus(
      "Done! " +
        businesses.length +
        " businesses, " +
        finalStats.phones +
        " phones, " +
        finalStats.emails +
        " emails, " +
        finalStats.websites +
        " websites."
    );

    return businesses;
  }
})();
