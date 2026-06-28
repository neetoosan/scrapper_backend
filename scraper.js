async function scrapePage(options = {}) {
  if (isGoogleMapsPage(location.href)) {
    return { error: "Google Maps scraping has been upgraded to a dedicated floating widget. Please click 'Scrape Google Maps' in the popup or use the 'Edge Maps Scraper' widget at the bottom-left of the Google Maps page." };
  }

  if (isYelpUrl(location.href)) {
    return scrapeYelpDocument(document, location.href);
  }

  if (isJijiUrl(location.href)) {
    return await scrapeJijiDocument(document, location.href);
  }
  
  if (isYellowPagesUrl(location.href)) {
    return scrapeYellowPagesDocument(document, location.href);
  }
  
  if (isGoogleSearchPage(location.href)) {
    return scrapeGoogleSearchPage(document, location.href);
  }
  
  if (isBingSearchPage(location.href)) {
    return scrapeBingSearchPage(document, location.href);
  }
  
  if (isWhatsAppWebUrl(location.href)) {
    return await scrapeWhatsAppWebDocument(document, location.href, options);
  }
  
  if (isFacebookBusinessPage(location.href)) {
    return scrapeFacebookBusinessPage(document, location.href);
  }

  return scrapeGenericDocument(document, location.href);
}

function extractStructuredContacts(doc) {
  const extracted = {
    names: [],
    companies: [],
    phones: [],
    emails: [],
    websites: [],
    addresses: [],
    socials: [],
    whatsapp: []
  };

  // 1. JSON-LD
  const jsonLdScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '').toLowerCase();
        
        if (type.includes('organization') || type.includes('localbusiness') || type.includes('person') || type.includes('store')) {
          if (item.name) extracted.names.push(item.name);
          if (item.telephone) extracted.phones.push(item.telephone);
          if (item.email) extracted.emails.push(item.email);
          if (item.url) extracted.websites.push(item.url);
          
          if (item.address) {
            if (typeof item.address === 'string') extracted.addresses.push(item.address);
            else if (typeof item.address === 'object') {
              const parts = [
                item.address.streetAddress, 
                item.address.addressLocality, 
                item.address.addressRegion, 
                item.address.postalCode, 
                item.address.addressCountry
              ].filter(Boolean);
              if (parts.length > 0) extracted.addresses.push(parts.join(', '));
            }
          }
          
          if (Array.isArray(item.sameAs)) {
            extracted.socials.push(...item.sameAs);
          } else if (typeof item.sameAs === 'string') {
            extracted.socials.push(item.sameAs);
          }
          
          if (item.contactPoint) {
            const points = Array.isArray(item.contactPoint) ? item.contactPoint : [item.contactPoint];
            for (const pt of points) {
              if (pt.telephone) extracted.phones.push(pt.telephone);
              if (pt.email) extracted.emails.push(pt.email);
            }
          }
        }
      }
    } catch {}
  }

  // 2. Microdata
  const props = Array.from(doc.querySelectorAll('[itemprop]'));
  for (const el of props) {
    const propName = el.getAttribute('itemprop');
    const value = el.getAttribute('content') || el.href || el.textContent;
    if (!value) continue;
    
    if (propName === 'telephone') extracted.phones.push(value);
    if (propName === 'email') extracted.emails.push(value.replace(/^mailto:/i, ''));
    if (propName === 'url' && /^https?:/i.test(value)) extracted.websites.push(value);
    if (propName === 'streetAddress' || propName === 'addressLocality' || propName === 'addressRegion') extracted.addresses.push(value);
    if (propName === 'name') extracted.names.push(value);
  }

  // 3. hCard
  const hCards = Array.from(doc.querySelectorAll('.vcard, .h-card'));
  for (const card of hCards) {
    const tels = Array.from(card.querySelectorAll('.tel')).map(n => n.textContent);
    const emails = Array.from(card.querySelectorAll('.email')).map(n => n.textContent || n.href);
    const orgs = Array.from(card.querySelectorAll('.org, .p-org')).map(n => n.textContent);
    const names = Array.from(card.querySelectorAll('.fn, .p-name')).map(n => n.textContent);
    const adrs = Array.from(card.querySelectorAll('.adr, .p-adr')).map(n => n.textContent);
    
    extracted.phones.push(...tels);
    extracted.emails.push(...emails.map(e => e.replace(/^mailto:/i, '')));
    extracted.companies.push(...orgs);
    extracted.names.push(...names);
    extracted.addresses.push(...adrs.map(a => a.replace(/\s+/g, ' ').trim()));
  }

  // 4. OpenGraph/Meta
  const metas = Array.from(doc.querySelectorAll('meta[property], meta[name]'));
  for (const meta of metas) {
    const key = meta.getAttribute('property') || meta.getAttribute('name');
    const val = meta.getAttribute('content');
    if (!val) continue;
    
    if (key === 'og:email' || key === 'business:contact_data:email') extracted.emails.push(val);
    if (key === 'og:phone_number' || key === 'business:contact_data:phone_number') extracted.phones.push(val);
    if (key === 'og:site_name') extracted.companies.push(val);
    if (key === 'business:contact_data:street_address' || key === 'business:contact_data:locality') extracted.addresses.push(val);
  }

  // 5. data-* attributes
  const dataEls = Array.from(doc.querySelectorAll('[data-phone], [data-email], [data-whatsapp], [data-tel], [data-telephone], [data-mobile], [data-contact-phone], [data-contact-email]'));
  for (const el of dataEls) {
    if (el.dataset.phone) extracted.phones.push(el.dataset.phone);
    if (el.dataset.tel) extracted.phones.push(el.dataset.tel);
    if (el.dataset.telephone) extracted.phones.push(el.dataset.telephone);
    if (el.dataset.mobile) extracted.phones.push(el.dataset.mobile);
    if (el.dataset.contactPhone) extracted.phones.push(el.dataset.contactPhone);
    if (el.dataset.email) extracted.emails.push(el.dataset.email);
    if (el.dataset.contactEmail) extracted.emails.push(el.dataset.contactEmail);
    if (el.dataset.whatsapp) extracted.whatsapp.push(el.dataset.whatsapp);
  }

  // 6. aria-label with phone-like content
  const ariaEls = Array.from(doc.querySelectorAll('button[aria-label], a[aria-label]'));
  for (const el of ariaEls) {
    const label = el.getAttribute('aria-label') || '';
    if (/(?:call|phone|tel)/i.test(label) || /^[\+\d\s\-\.\(\)]{7,20}$/.test(label)) {
      extracted.phones.push(label);
    }
  }

  // 7. tel: links
  const telLinks = Array.from(doc.querySelectorAll('a[href^="tel:"]'));
  for (const link of telLinks) {
    extracted.phones.push(link.href);
  }

  // 8. mailto: links
  const mailtoLinks = Array.from(doc.querySelectorAll('a[href^="mailto:"]'));
  for (const link of mailtoLinks) {
    extracted.emails.push(link.href.replace(/^mailto:/i, '').trim());
  }
  
  // Clean up
  extracted.phones = extracted.phones.map(normalizePhone).filter(Boolean);
  extracted.whatsapp = extracted.whatsapp.map(normalizePhone).filter(Boolean);
  extracted.socials = extracted.socials.map(extractSocialHandle).filter(Boolean);
  
  return extracted;
}

function scrapeGenericDocument(doc, pageUrl) {
  const structured = extractStructuredContacts(doc);
  
  const text = collectVisibleText(doc.body);
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanDoc = createSanitizedDocument(doc);
  const anchors = Array.from(cleanDoc.querySelectorAll("a[href]"));
  const metadata = Array.from(cleanDoc.querySelectorAll("meta"))
    .map((meta) => meta.content?.trim())
    .filter(Boolean);
  const headings = Array.from(cleanDoc.querySelectorAll("h1, h2, h3, h4"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean);

  const companyHints = [
    cleanDoc.querySelector("[itemprop='name']")?.textContent,
    cleanDoc.querySelector("meta[property='og:site_name']")?.content,
    cleanDoc.querySelector("meta[name='application-name']")?.content,
    cleanDoc.querySelector("meta[name='twitter:site']")?.content
  ].filter(Boolean);

  const people = uniqueMatches([...structured.names, ...collectNames(lines, headings, metadata)]);
  const companies = uniqueMatches([...structured.companies, ...collectCompanies(lines, headings, companyHints)]);
  
  const regexEmails = uniqueMatches([
    ...matchAll(normalizedText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
  ]);
  const emails = uniqueMatches([...structured.emails, ...regexEmails]);

  const regexPhones = uniqueMatches(extractPhonesFromText(normalizedText));
  const phoneNumbers = uniqueMatches([...structured.phones, ...regexPhones]);

  const regexWhatsapp = uniqueMatches(extractWhatsappFromText(normalizedText));
  const linkWhatsapp = uniqueMatches(
    anchors
      .map((anchor) => anchor.href)
      .filter((href) => /wa\.me|whatsapp\.com/i.test(href))
      .map((href) => {
        const match = href.match(/(\+?\d[\d]{6,})/);
        return match ? normalizePhone(match[1]) : null;
      })
      .filter(Boolean)
  );
  const whatsappNumbers = uniqueMatches([...structured.whatsapp, ...regexWhatsapp, ...linkWhatsapp]);

  const socialMediaHandles = uniqueMatches([
    ...structured.socials,
    ...anchors
      .map((anchor) => anchor.href)
      .map(extractSocialHandle)
      .filter(Boolean)
  ]);
  
  const textAddresses = extractAddressesFromText(normalizedText);
  const addresses = uniqueMatches([...structured.addresses, ...textAddresses]);
  
  const websites = uniqueMatches([...structured.websites]);

  const listings = buildListingsFromParallelArrays({
    names: people,
    companyNames: companies,
    phoneNumbers,
    whatsappNumbers,
    socialMediaHandles,
    emails,
    websites,
    addresses
  });

  return {
    page: {
      title: doc.title || "",
      url: pageUrl
    },
    names: people,
    companyNames: companies,
    phoneNumbers,
    whatsappNumbers,
    socialMediaHandles,
    emails,
    websites,
    addresses,
    listings
  };
}

function collectCandidateLinks() {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      href: anchor.href,
      text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim(),
      rel: anchor.rel || ""
    }))
    .filter((item) => item.href);
}

function buildMarketplaceQueue(rawLinks, currentUrl) {
  const current = new URL(currentUrl);
  const seen = new Set([stripUrlHash(current.toString())]);
  const queue = [];

  for (const link of rawLinks) {
    let url;

    try {
      url = new URL(link.href, currentUrl);
    } catch {
      continue;
    }

    if (url.origin !== current.origin || !/^https?:$/i.test(url.protocol)) {
      continue;
    }

    url.hash = "";
    const candidate = url.toString();

    if (seen.has(candidate)) {
      continue;
    }

    if (isYelpUrl(currentUrl) && !isYelpBusinessUrl(candidate)) {
      continue;
    }

    if (isJijiUrl(currentUrl) && !isJijiListingUrl(candidate)) {
      continue;
    }
    
    if (isYellowPagesUrl(currentUrl) && !isYellowPagesBusinessUrl(candidate)) {
      continue;
    }

    seen.add(candidate);
    queue.push(candidate);

    if (queue.length >= WEBSITE_PAGE_LIMIT - 1) {
      break;
    }
  }

  return queue;
}

function buildWebsiteQueue(rawLinks, currentUrl) {
  const baseUrl = new URL(currentUrl);
  const sameOriginLinks = [];

  for (const link of rawLinks) {
    try {
      const url = new URL(link.href, currentUrl);
      if (url.origin !== baseUrl.origin) {
        continue;
      }
      if (!/^https?:$/i.test(url.protocol)) {
        continue;
      }
      if (url.hash) {
        url.hash = "";
      }

      sameOriginLinks.push({
        url: url.toString(),
        score: scoreInternalLink(url, link.text, link.rel),
        pathDepth: url.pathname.split("/").filter(Boolean).length
      });
    } catch {
      // Ignore invalid URLs.
    }
  }

  const deduped = Array.from(
    new Map(sameOriginLinks.map((item) => [item.url, item])).values()
  ).filter((item) => item.url !== currentUrl);

  deduped.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.pathDepth - right.pathDepth;
  });

  return deduped
    .filter((item) => item.score > -5)
    .slice(0, WEBSITE_PAGE_LIMIT - 1)
    .map((item) => item.url);
}

function scoreInternalLink(url, text, rel) {
  const value = `${url.pathname} ${text} ${rel}`.toLowerCase();
  let score = 0;

  const strongMatches = ["contact", "about", "team", "staff", "leadership", "company", "people", "management", "our-story", "yellowpages", "facebook"];
  const mediumMatches = ["service", "support", "location", "directory", "branch", "office", "meet", "connect"];
  const weakAvoid = ["privacy", "terms", "policy", "login", "signin", "signup", "register", "cart", "checkout", "search", "blog", "post", "article"];

  for (const token of strongMatches) {
    if (value.includes(token)) {
      score += 8;
    }
  }

  for (const token of mediumMatches) {
    if (value.includes(token)) {
      score += 3;
    }
  }

  for (const token of weakAvoid) {
    if (value.includes(token)) {
      score -= 5;
    }
  }

  if (url.pathname === "/" || url.pathname === "") {
    score += 2;
  }

  return score;
}

function isGoogleMapsPage(url) {
  const href = url || (typeof location !== 'undefined' ? location.href : '');
  return /google\.com\/maps/i.test(href);
}

function isSupportedMarketplaceUrl(url) {
  return isYelpUrl(url) || isJijiUrl(url) || isYellowPagesUrl(url) || isGoogleSearchPage(url) || isBingSearchPage(url) || isWhatsAppWebUrl(url);
}

function isWhatsAppWebUrl(url) {
  return /web\.whatsapp\.com/i.test(url);
}

function isGoogleSearchPage(url) {
  return /google\.[a-z.]+\/search/i.test(url) && !/tbm=map/i.test(url);
}

function isBingSearchPage(url) {
  return /bing\.com\/search/i.test(url);
}

function isYelpUrl(url) {
  try {
    return new URL(url).hostname.includes("yelp.com");
  } catch {
    return false;
  }
}

function isYelpBusinessUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("yelp.com") && /^\/biz\/[^/]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isJijiUrl(url) {
  try {
    return /jiji\.(?:ng|com\.gh|co\.ke|ug|co\.tz|et|com\.eg|sn)/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isJijiListingUrl(url) {
  try {
    const parsed = new URL(url);
    return /jiji\.(?:ng|com\.gh|co\.ke|ug|co\.tz|et|com\.eg|sn)/i.test(parsed.hostname) && /\.html(?:$|\?)/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

function isYellowPagesUrl(url) {
  try {
    return /yellowpages\.com|yp\.com/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isYellowPagesBusinessUrl(url) {
  try {
    const parsed = new URL(url);
    return /yellowpages\.com|yp\.com/i.test(parsed.hostname) && /^\/mip\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isFacebookBusinessPage(url) {
  try {
    const parsed = new URL(url);
    if (!/facebook\.com/i.test(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
    if (path === '' || path === '/home.php' || path === '/feed' || path === '/login') return false;
    return !/^\/(?:groups|events|marketplace|watch|reels|stories|messages|notifications|friends)(?:\/|$)/i.test(path);
  } catch { 
    return false; 
  }
}

// [DELETED] Dead Google Maps Scraper Code. Google Maps scraping is now fully implemented in gmaps-scraper.js and gmaps-ui.js.
function scrapeYelpDocument(doc, pageUrl) {
  return isYelpBusinessUrl(pageUrl) ? scrapeYelpBusinessPage(doc, pageUrl) : scrapeYelpResultsPage(doc, pageUrl);
}

function scrapeYelpResultsPage(doc, pageUrl) {
  const anchors = Array.from(doc.querySelectorAll('a[href*="/biz/"]'));
  const listingMap = new Map();

  for (const anchor of anchors) {
    const href = absoluteUrl(anchor.href, pageUrl);
    if (!isYelpBusinessUrl(href)) {
      continue;
    }

    const card = findMarketplaceContainer(anchor);
    const cardText = collectVisibleText(card);
    const name = cleanBusinessName(
      anchor.getAttribute("name") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        firstMeaningfulLine(cardText)
    );

    if (!name || isLikelyNoise(name)) {
      continue;
    }

    const phones = extractPhonesFromText(cardText);
    const emails = extractEmailsFromText(cardText);
    const socials = extractSocialsFromElement(card);
    const whatsappNumbers = extractWhatsappNumbersFromElement(card);

    listingMap.set(href, {
      name,
      companyName: name,
      phoneNumbers: phones,
      whatsappNumbers,
      socialMediaHandles: socials,
      emails,
      sourceUrl: href,
      pageTitle: doc.title || ""
    });
  }

  return finalizeMarketplaceResult(doc.title || "", pageUrl, Array.from(listingMap.values()));
}

function scrapeYelpBusinessPage(doc, pageUrl) {
  const page = createSanitizedDocument(doc);
  const root = page.body || page;
  const name = cleanBusinessName(
    page.querySelector("h1")?.textContent ||
      page.querySelector('meta[property="og:title"]')?.content ||
      page.title
  );
  const phones = uniqueMatches([
    ...Array.from(page.querySelectorAll('a[href^="tel:"]'))
      .map((node) => normalizePhone(node.getAttribute("href") || ""))
      .filter(Boolean),
    ...extractPhonesFromText(collectVisibleText(root))
  ]);
  const emails = uniqueMatches([
    ...Array.from(page.querySelectorAll('a[href^="mailto:"]'))
      .map((node) => node.getAttribute("href")?.replace(/^mailto:/i, "").trim())
      .filter(Boolean),
    ...extractEmailsFromText(collectVisibleText(root))
  ]);

  const listing = {
    name,
    companyName: name,
    phoneNumbers: phones,
    whatsappNumbers: extractWhatsappNumbersFromElement(root),
    socialMediaHandles: extractSocialsFromElement(root),
    emails,
    sourceUrl: pageUrl,
    pageTitle: page.title || ""
  };

  return finalizeMarketplaceResult(page.title || "", pageUrl, listing.name ? [listing] : []);
}


async function scrapeJijiDocument(doc, pageUrl) {
  return isJijiListingUrl(pageUrl) ? await scrapeJijiListingPage(doc, pageUrl) : scrapeJijiResultsPage(doc, pageUrl);
}

function scrapeJijiResultsPage(doc, pageUrl) {
  const anchors = Array.from(doc.querySelectorAll('a[href$=".html"], a[href*=".html?"]'));
  const listingMap = new Map();

  for (const anchor of anchors) {
    const href = absoluteUrl(anchor.href, pageUrl);
    if (!isJijiListingUrl(href)) {
      continue;
    }

    const card = findMarketplaceContainer(anchor);
    const cardText = collectVisibleText(card);
    const name = cleanBusinessName(
      anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        firstMeaningfulLine(cardText)
    );

    if (!name || isLikelyNoise(name)) {
      continue;
    }

    const sellerName = findSellerName(cardText);
    const phones = extractPhonesFromText(cardText);
    const whatsappNumbers = extractWhatsappNumbersFromElement(card);
    const emails = extractEmailsFromText(cardText);
    const socials = extractSocialsFromElement(card);

    listingMap.set(href, {
      name: sellerName || name,
      companyName: name,
      phoneNumbers: phones,
      whatsappNumbers,
      socialMediaHandles: socials,
      emails,
      sourceUrl: href,
      pageTitle: doc.title || ""
    });
  }

  return finalizeMarketplaceResult(doc.title || "", pageUrl, Array.from(listingMap.values()));
}

async function clickJijiRevealButtons(doc) {
  const buttons = Array.from(doc.querySelectorAll('button, a, [role="button"]')).filter(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    return /(show phone|show contact|call seller|show number|view phone)/i.test(text)
      && el.offsetParent !== null;
  });
  
  for (const btn of buttons.slice(0, 5)) {
    try {
      btn.click();
      await waitForDom(800);
    } catch {}
  }
}

async function scrapeJijiListingPage(doc, pageUrl) {
  await clickJijiRevealButtons(doc);
  
  const page = createSanitizedDocument(doc);
  const root = page.body || page;
  const title = cleanBusinessName(
    page.querySelector("h1")?.textContent ||
      page.querySelector('meta[property="og:title"]')?.content ||
      page.title
  );
  const allText = collectVisibleText(root);
  const sellerName = findSellerName(allText);

  const listing = {
    name: sellerName || title,
    companyName: title,
    phoneNumbers: uniqueMatches([
      ...Array.from(page.querySelectorAll('a[href^="tel:"]'))
        .map((node) => normalizePhone(node.getAttribute("href") || ""))
        .filter(Boolean),
      ...extractPhonesFromText(allText)
    ]),
    whatsappNumbers: extractWhatsappNumbersFromElement(root),
    socialMediaHandles: extractSocialsFromElement(root),
    emails: uniqueMatches([
      ...Array.from(page.querySelectorAll('a[href^="mailto:"]'))
        .map((node) => node.getAttribute("href")?.replace(/^mailto:/i, "").trim())
        .filter(Boolean),
      ...extractEmailsFromText(allText)
    ]),
    sourceUrl: pageUrl,
    pageTitle: page.title || ""
  };

  return finalizeMarketplaceResult(page.title || "", pageUrl, title ? [listing] : []);
}

function scrapeYellowPagesDocument(doc, pageUrl) {
  if (pageUrl.includes('/search')) {
    const cards = Array.from(doc.querySelectorAll('.srp-listing, .search-results .result, .v-card'));
    const listingMap = new Map();
    
    for (const card of cards) {
      const nameNode = card.querySelector('.business-name, h2, .n, [itemprop="name"]');
      if (!nameNode) continue;
      
      const name = cleanBusinessName(nameNode.textContent);
      const anchor = card.querySelector('a[href*="/mip/"]') || nameNode.querySelector('a') || nameNode;
      const href = anchor.href ? absoluteUrl(anchor.href, pageUrl) : pageUrl;
      
      const phoneNode = card.querySelector('.phones, .phone, [itemprop="telephone"]');
      const phones = phoneNode ? [normalizePhone(phoneNode.textContent)].filter(Boolean) : extractPhonesFromText(collectVisibleText(card));
      
      const addressNode = card.querySelector('.adr, .address, [itemprop="address"]');
      const address = addressNode ? addressNode.textContent.replace(/\s+/g, ' ').trim() : "";
      
      const websiteNode = card.querySelector('a.track-visit-website, a[href^="http"]:not([href*="yellowpages"])');
      const website = websiteNode ? websiteNode.href : "";
      
      const categoryNode = card.querySelector('.categories, .info-primary');
      const category = categoryNode ? categoryNode.textContent.replace(/\s+/g, ' ').trim() : "";
      
      listingMap.set(href, {
        name,
        companyName: name,
        phoneNumbers: phones,
        whatsappNumbers: [],
        socialMediaHandles: extractSocialsFromElement(card),
        emails: extractEmailsFromText(collectVisibleText(card)),
        website,
        address,
        category,
        sourceUrl: href,
        pageTitle: doc.title || ""
      });
    }
    return finalizeMarketplaceResult(doc.title || "", pageUrl, Array.from(listingMap.values()));
  } else {
    // detail page
    const structured = extractStructuredContacts(doc);
    const root = createSanitizedDocument(doc);
    const text = collectVisibleText(root);
    
    const name = cleanBusinessName(doc.querySelector('h1')?.textContent || doc.title);
    
    const listing = {
      name: structured.names[0] || name,
      companyName: name,
      phoneNumbers: uniqueMatches([...structured.phones, ...extractPhonesFromText(text)]),
      whatsappNumbers: [],
      socialMediaHandles: structured.socials,
      emails: uniqueMatches([...structured.emails, ...extractEmailsFromText(text)]),
      website: structured.websites[0] || "",
      address: structured.addresses[0] || "",
      sourceUrl: pageUrl,
      pageTitle: doc.title || ""
    };
    
    return finalizeMarketplaceResult(doc.title || "", pageUrl, [listing]);
  }
}

function scrapeFacebookBusinessPage(doc, pageUrl) {
  const structured = extractStructuredContacts(doc);
  const text = collectVisibleText(doc.body);
  
  const name = cleanBusinessName(
    doc.querySelector('h1')?.textContent || 
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.title
  );
  
  const emails = uniqueMatches([
    ...structured.emails,
    ...Array.from(doc.querySelectorAll('a[href^="mailto:"]')).map(a => a.href.replace(/^mailto:/i, '').trim()),
    ...extractEmailsFromText(text)
  ]);
  
  const phones = uniqueMatches([
    ...structured.phones,
    ...Array.from(doc.querySelectorAll('a[href^="tel:"]')).map(a => normalizePhone(a.href)),
    ...extractPhonesFromText(text)
  ].filter(Boolean));
  
  const whatsapp = uniqueMatches([
    ...structured.whatsapp,
    ...extractWhatsappNumbersFromElement(doc.body)
  ]);
  
  const website = structured.websites.find(w => !w.includes('facebook.com')) || "";
  
  const listing = {
    name,
    companyName: name,
    phoneNumbers: phones,
    whatsappNumbers: whatsapp,
    socialMediaHandles: structured.socials,
    emails,
    website,
    address: structured.addresses[0] || "",
    sourceUrl: pageUrl,
    pageTitle: doc.title || ""
  };
  
  return finalizeMarketplaceResult(doc.title || "", pageUrl, [listing]);
}

function scrapeGoogleSearchPage(doc, pageUrl) {
  const listingsMap = new Map();
  
  // Organic results, Places local pack, Knowledge Graph cards
  const blocks = Array.from(doc.querySelectorAll('.g, .VkpGBb, div[data-attrid], div[jscontroller], .u1yAec, .tF25fe, .VkpGBb'));
  
  for (const block of blocks) {
    const text = collectVisibleText(block);
    if (!text || text.length < 5) continue;

    const headingEl = block.querySelector('h3, [role="heading"], .OSrAec, .rGfe3e, .dbg0pd');
    let name = headingEl ? headingEl.textContent.trim() : '';
    if (!name || name.length < 2 || name.toLowerCase().includes('people also ask')) continue;
    name = cleanBusinessName(name);

    const key = name.toLowerCase();
    if (listingsMap.has(key)) continue;

    const phones = extractPhonesFromText(text);
    const emails = extractEmailsFromText(text);
    const whatsapp = extractWhatsappNumbersFromElement(block);

    let website = "";
    const links = Array.from(block.querySelectorAll('a[href]'));
    for (const a of links) {
      const href = a.href;
      if (/^https?:/i.test(href) && !/google\.[a-z.]+/i.test(href) && !/schema\.org/i.test(href) && !/googleusercontent/i.test(href)) {
        website = href;
        break;
      }
    }

    const addresses = extractAddressesFromText(text);

    if (phones.length > 0 || emails.length > 0 || website || addresses.length > 0 || headingEl) {
      listingsMap.set(key, {
        name,
        companyName: name,
        phoneNumbers: phones,
        whatsappNumbers: whatsapp,
        socialMediaHandles: [],
        emails,
        website,
        address: addresses[0] || "",
        sourceUrl: pageUrl,
        pageTitle: doc.title || ""
      });
    }
  }

  if (listingsMap.size === 0) {
    return scrapeGenericDocument(doc, pageUrl);
  }

  return finalizeMarketplaceResult(doc.title || "Google Search Results", pageUrl, Array.from(listingsMap.values()));
}

function scrapeBingSearchPage(doc, pageUrl) {
  const listingsMap = new Map();
  const blocks = Array.from(doc.querySelectorAll('.b_algo, .b_ans, .b_entityTP'));
  
  for (const block of blocks) {
    const text = collectVisibleText(block);
    if (!text) continue;

    const headingEl = block.querySelector('h2, h3');
    let name = headingEl ? headingEl.textContent.trim() : '';
    if (!name || name.length < 2) continue;
    name = cleanBusinessName(name);

    const key = name.toLowerCase();
    if (listingsMap.has(key)) continue;

    const phones = extractPhonesFromText(text);
    const emails = extractEmailsFromText(text);
    const whatsapp = extractWhatsappNumbersFromElement(block);

    let website = "";
    const links = Array.from(block.querySelectorAll('a[href]'));
    for (const a of links) {
      const href = a.href;
      if (/^https?:/i.test(href) && !/bing\.com/i.test(href)) {
        website = href;
        break;
      }
    }

    const addresses = extractAddressesFromText(text);

    if (phones.length > 0 || emails.length > 0 || website || addresses.length > 0) {
      listingsMap.set(key, {
        name,
        companyName: name,
        phoneNumbers: phones,
        whatsappNumbers: whatsapp,
        socialMediaHandles: [],
        emails,
        website,
        address: addresses[0] || "",
        sourceUrl: pageUrl,
        pageTitle: doc.title || ""
      });
    }
  }

  if (listingsMap.size === 0) {
    return scrapeGenericDocument(doc, pageUrl);
  }

  return finalizeMarketplaceResult(doc.title || "Bing Search Results", pageUrl, Array.from(listingsMap.values()));
}

async function scrapeWhatsAppWebDocument(doc, pageUrl, options = {}) {
  const target = options.waTarget || "group";
  const autoScroll = options.waAutoScroll !== false;
  const members = new Map();

  if (target === "group") {
    return await scrapeWhatsAppGroup(doc, pageUrl, members, autoScroll);
  } else {
    return await scrapeWhatsAppChatList(doc, pageUrl, members, autoScroll);
  }
}

// ── GROUP SCRAPING ─────────────────────────────────────────────────────────

async function scrapeWhatsAppGroup(doc, pageUrl, members, autoScroll) {

  // Step 1: Find the Group Info panel on the RIGHT side
  const groupInfoPanel = findGroupInfoPanel(doc);
  if (!groupInfoPanel) {
    throw new Error(
      "Could not find the Group Info panel.\n\n" +
      "Please make sure you:\n" +
      "1. Open a group chat\n" +
      "2. Click the group name at the top to open Group Info on the right side"
    );
  }

  // Step 2: Click "View all (X more)" to open the full member list modal
  const viewAllClicked = await clickViewAllMembers(doc, groupInfoPanel);

  if (viewAllClicked) {
    // Step 3: Find the modal that just opened
    await waitForDom(1500); // Give the modal time to animate open

    const modal = findMemberListModal(doc);
    if (!modal) {
      throw new Error(
        "Clicked 'View all' but the member list modal did not open.\n" +
        "Please try again — WhatsApp may have been slow to respond."
      );
    }

    // Step 4: Auto-scroll through the modal and extract all members
    const itemSelector = "div[role='listitem'], div[role='row']";
    extractVisibleMembers(modal, itemSelector, members, pageUrl, doc.title);

    if (autoScroll) {
      // Find the scrollable container inside the modal
      const scrollTarget = findScrollableChild(modal) || modal;
      await autoScrollAndExtract(scrollTarget, modal, itemSelector, members, pageUrl, doc.title);
    }
  } else {
    // Fallback: "View all" button not found — scrape whatever is visible in the panel
    const itemSelector = "div[role='listitem'], div[role='row']";
    extractVisibleMembers(groupInfoPanel, itemSelector, members, pageUrl, doc.title);

    if (autoScroll) {
      const scrollTarget = findScrollableChild(groupInfoPanel) || groupInfoPanel;
      await autoScrollAndExtract(scrollTarget, groupInfoPanel, itemSelector, members, pageUrl, doc.title);
    }
  }

  const listings = Array.from(members.values());
  if (listings.length === 0) {
    throw new Error(
      "No group members found.\n\n" +
      "Please make sure:\n" +
      "1. The Group Info panel is open on the right side\n" +
      "2. You can see the member list (with names and phone numbers)"
    );
  }
  return finalizeMarketplaceResult(doc.title || "WhatsApp Group", pageUrl, listings);
}

// ── CHAT LIST SCRAPING ─────────────────────────────────────────────────────

async function scrapeWhatsAppChatList(doc, pageUrl, members, autoScroll) {
  const scrollContainer = doc.querySelector("div[id='pane-side']");
  if (!scrollContainer) {
    throw new Error(
      "Could not find the WhatsApp Chat list.\n" +
      "Please make sure WhatsApp Web is fully loaded."
    );
  }

  const itemSelector = "div[id='pane-side'] div[role='listitem'], div[id='pane-side'] div[role='row']";
  extractVisibleMembers(doc, itemSelector, members, pageUrl, doc.title);

  if (autoScroll) {
    await autoScrollAndExtract(scrollContainer, doc, itemSelector, members, pageUrl, doc.title);
  }

  const listings = Array.from(members.values());
  if (listings.length === 0) {
    throw new Error("No contacts found in the chat list.");
  }
  return finalizeMarketplaceResult(doc.title || "WhatsApp Contacts", pageUrl, listings);
}

// ── HELPER: Find the Group Info panel ──────────────────────────────────────

function findGroupInfoPanel(doc) {
  // Strategy 1: Look for the panel header that says "Group info"
  const allHeaders = Array.from(doc.querySelectorAll('header, div[data-testid="conversation-info-header"], [role="banner"]'));
  for (const header of allHeaders) {
    const text = (header.textContent || "").toLowerCase();
    if (text.includes("group info") || text.includes("group details")) {
      // Walk up to find the containing panel
      let panel = header.parentElement;
      while (panel && panel !== doc.body) {
        // The panel is typically a direct child of a flex container
        if (panel.querySelector("div[role='listitem'], div[role='row']")) {
          return panel;
        }
        panel = panel.parentElement;
      }
    }
  }

  // Strategy 2: Look for spans that say "Group info"
  const spans = Array.from(doc.querySelectorAll('span'));
  for (const span of spans) {
    const text = (span.textContent || "").trim().toLowerCase();
    if (text === "group info" || text === "group details") {
      let panel = span.parentElement;
      while (panel && panel !== doc.body) {
        if (panel.querySelector("div[role='listitem'], div[role='row']")) {
          return panel;
        }
        panel = panel.parentElement;
      }
    }
  }

  // Strategy 3: Look for a section that has "members" text and list items
  // but is NOT the pane-side (left chat list)
  const sections = Array.from(doc.querySelectorAll('section, div[role="complementary"], div[data-testid]'));
  for (const section of sections) {
    if (section.id === 'pane-side' || section.closest('#pane-side')) continue;
    const text = (section.textContent || "").toLowerCase();
    if (text.includes("members") && section.querySelector("div[role='listitem'], div[role='row']")) {
      return section;
    }
  }

  // Strategy 4: Find divs that contain "members" count text and list items,
  // excluding the left panel
  const allDivs = Array.from(doc.querySelectorAll('div'));
  for (const div of allDivs) {
    if (div.id === 'pane-side' || div.closest('#pane-side')) continue;
    if (div.id === 'main' || div.closest('#main')) continue;
    const directText = Array.from(div.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent)
      .join('');
    const spanTexts = Array.from(div.querySelectorAll(':scope > span, :scope > div > span'))
      .map(s => s.textContent || '')
      .join(' ');
    const combined = (directText + ' ' + spanTexts).toLowerCase();
    if (/\d+\s*members/.test(combined) && div.querySelector("div[role='listitem'], div[role='row']")) {
      return div;
    }
  }

  return null;
}

// ── HELPER: Click "View all (X more)" ──────────────────────────────────────

async function clickViewAllMembers(doc, panel) {
  // Look for "View all" link/button inside the panel
  const candidates = Array.from(panel.querySelectorAll('div, span, button, a'));

  for (const el of candidates) {
    const text = (el.textContent || "").trim().toLowerCase();
    // Match "View all (963 more)" or "View all" or "See all members"
    if (/^view all/i.test(text) || /^see all/i.test(text) || /\d+\s*more\)?$/i.test(text)) {
      // Make sure it's a leaf-ish element (not a huge container)
      if (el.children.length > 5) continue;
      if (el.textContent.length > 100) continue;

      try {
        el.click();
        await waitForDom(500);
        return true;
      } catch (e) {
        // Try dispatching a mouse event instead
        try {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await waitForDom(500);
          return true;
        } catch (e2) {}
      }
    }
  }

  // Fallback: look anywhere in the doc for "View all" that's near "members"
  const allElements = Array.from(doc.querySelectorAll('div, span, button, a'));
  for (const el of allElements) {
    if (el.closest('#pane-side') || el.closest('#main')) continue;
    const text = (el.textContent || "").trim();
    if (/^View all\s*\(/i.test(text) && text.length < 50) {
      try {
        el.click();
        await waitForDom(500);
        return true;
      } catch (e) {}
    }
  }

  return false;
}

// ── HELPER: Find the member list modal after clicking "View all" ───────────

function findMemberListModal(doc) {
  // Strategy 1: data-animate-modal-body (WhatsApp's known modal attribute)
  const animateModal = doc.querySelector("div[data-animate-modal-body='true']");
  if (animateModal && animateModal.querySelector("div[role='listitem'], div[role='row']")) {
    return animateModal;
  }

  // Strategy 2: Look for modal/overlay containers with list items
  const modalSelectors = [
    'div[data-testid="popup-contents"]',
    'div[role="dialog"]',
    'div[data-animate-modal-body]',
    'div[tabindex="-1"]'
  ];

  for (const selector of modalSelectors) {
    const candidates = Array.from(doc.querySelectorAll(selector));
    for (const candidate of candidates) {
      if (candidate.closest('#pane-side')) continue;
      if (candidate.querySelector("div[role='listitem'], div[role='row']")) {
        return candidate;
      }
    }
  }

  // Strategy 3: Find any overlay that appeared recently (has list items and is NOT the panel)
  const overlays = Array.from(doc.querySelectorAll('div'));
  for (const div of overlays) {
    if (div.id === 'pane-side' || div.closest('#pane-side')) continue;
    if (div.id === 'main' || div.closest('#main')) continue;

    const style = window.getComputedStyle(div);
    const isOverlay = style.position === 'fixed' || style.position === 'absolute';
    const hasListItems = div.querySelector("div[role='listitem'], div[role='row']");
    const hasSearch = div.querySelector('input[type="text"], div[contenteditable]');

    if (isOverlay && hasListItems) {
      return div;
    }
    // Modal with search + list items
    if (hasSearch && hasListItems && div.querySelectorAll("div[role='listitem'], div[role='row']").length > 3) {
      return div;
    }
  }

  return null;
}

// ── HELPER: Find the scrollable child inside a container ───────────────────

function findScrollableChild(container) {
  const children = Array.from(container.querySelectorAll('div'));
  for (const child of children) {
    if (child.scrollHeight > child.clientHeight + 50) {
      // This div has overflow content — it's scrollable
      const style = window.getComputedStyle(child);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return child;
      }
    }
  }
  // Fallback: check if the container itself scrolls
  if (container.scrollHeight > container.clientHeight + 50) {
    return container;
  }
  return null;
}

// ── HELPER: Extract visible members from a container ───────────────────────

function extractVisibleMembers(container, itemSelector, members, pageUrl, pageTitle) {
  const items = container.querySelectorAll(itemSelector);
  items.forEach((item) => {
    const nameElement = item.querySelector("span[dir='auto'][title], span[dir='auto']");
    const allSpans = item.querySelectorAll("span[dir='auto']");

    let name = nameElement
      ? (nameElement.getAttribute('title') || nameElement.innerText.trim())
      : null;
    if (name) name = name.replace(/^~/, "").trim();

    // Skip "You" and "Add member" entries
    if (name && /^(you|add member|add participant|invite)$/i.test(name)) return;

    let number = "";
    const textElements = Array.from(allSpans).map((el) => el.innerText.trim());
    const numberMatch = textElements.find((text) =>
      /(\+?\d{1,4}[-.\\s]?)?(\(?\d{2,5}\)?[-.\\s]?)?(\d{3,5}[-.\\s]?\d{3,5}[-.\\s]?\d{0,5})/.test(text)
      && text.match(/\d/g)?.length >= 7
    );
    if (numberMatch) number = normalizePhone(numberMatch);

    if (!name && number) name = number;

    const displayPhone = number || "Hidden (Saved Contact)";

    if (name && !members.has(name + number)) {
      members.set(name + number, {
        name,
        phoneNumbers: [displayPhone],
        whatsappNumbers: [displayPhone],
        companyName: name,
        emails: [],
        socialMediaHandles: [],
        website: "",
        address: "",
        sourceUrl: pageUrl,
        pageTitle: pageTitle
      });
    }
  });
}

// ── HELPER: Auto-scroll and extract ────────────────────────────────────────

async function autoScrollAndExtract(scrollTarget, extractContainer, itemSelector, members, pageUrl, pageTitle) {
  let lastScrollTop = -1;
  let retries = 0;
  const maxRetries = 12; // More patience for large groups
  const scrollStep = 300; // Smaller steps to not skip anyone
  const scrollDelay = 600; // More time for WhatsApp to load next batch

  while (retries < maxRetries) {
    scrollTarget.scrollBy(0, scrollStep);
    await waitForDom(scrollDelay);
    extractVisibleMembers(extractContainer, itemSelector, members, pageUrl, pageTitle);

    if (Math.abs(scrollTarget.scrollTop - lastScrollTop) < 2) {
      retries++;
      // On retry, wait longer — WhatsApp might be fetching from server
      if (retries < maxRetries) {
        await waitForDom(1000);
      }
    } else {
      retries = 0;
    }
    lastScrollTop = scrollTarget.scrollTop;
  }
}

function scrapeGoogleSearchPage(doc, pageUrl) {
  const listings = [];
  const blocks = Array.from(doc.querySelectorAll('.g, .VkpGBb, div[data-attrid], div[jscontroller]'));
  
  for (const block of blocks) {
    const text = block.textContent || "";
    const phones = extractPhonesFromText(text);
    const emails = extractEmailsFromText(text);
    const whatsapp = extractWhatsappFromText(text);
    
    if (phones.length > 0 || emails.length > 0) {
      const heading = block.querySelector('h3, [role="heading"]');
      const name = heading ? heading.textContent.trim() : firstMeaningfulLine(text);
      if (!name || name.length < 3) continue;
      
      const links = Array.from(block.querySelectorAll('a[href]'));
      const website = links.find(a => /^https?:/i.test(a.href) && !/google/i.test(a.href))?.href || "";
      const addresses = extractAddressesFromText(text);
      
      listings.push({
        name: cleanBusinessName(name),
        companyName: cleanBusinessName(name),
        phoneNumbers: phones,
        whatsappNumbers: whatsapp,
        socialMediaHandles: [],
        emails: emails,
        website: website,
        address: addresses[0] || "",
        sourceUrl: pageUrl,
        pageTitle: doc.title
      });
    }
  }
  
  const deduplicated = dedupeListings(listings);
  if (deduplicated.length > 0) {
    return finalizeMarketplaceResult(doc.title, pageUrl, deduplicated);
  }
  return scrapeGenericDocument(doc, pageUrl);
}

function scrapeBingSearchPage(doc, pageUrl) {
  const listings = [];
  const blocks = Array.from(doc.querySelectorAll('.b_algo, .b_ans, .b_entityTP'));
  
  for (const block of blocks) {
    const text = block.textContent || "";
    const phones = extractPhonesFromText(text);
    const emails = extractEmailsFromText(text);
    const whatsapp = extractWhatsappFromText(text);
    
    if (phones.length > 0 || emails.length > 0) {
      const heading = block.querySelector('h2, h3');
      const name = heading ? heading.textContent.trim() : firstMeaningfulLine(text);
      if (!name || name.length < 3) continue;
      
      const links = Array.from(block.querySelectorAll('a[href]'));
      const website = links.find(a => /^https?:/i.test(a.href) && !/bing/i.test(a.href))?.href || "";
      const addresses = extractAddressesFromText(text);
      
      listings.push({
        name: cleanBusinessName(name),
        companyName: cleanBusinessName(name),
        phoneNumbers: phones,
        whatsappNumbers: whatsapp,
        socialMediaHandles: [],
        emails: emails,
        website: website,
        address: addresses[0] || "",
        sourceUrl: pageUrl,
        pageTitle: doc.title
      });
    }
  }
  
  const deduplicated = dedupeListings(listings);
  if (deduplicated.length > 0) {
    return finalizeMarketplaceResult(doc.title, pageUrl, deduplicated);
  }
  return scrapeGenericDocument(doc, pageUrl);
}

function collectNames(lines, headings, metadata) {
  const candidates = new Set();
  const sources = [...headings, ...lines.slice(0, 40), ...metadata.slice(0, 20)];

  for (const value of sources) {
    const match = value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g);
    if (!match) {
      continue;
    }

    for (const name of match) {
      if (looksLikeCompany(name) || name.length > 50) {
        continue;
      }

      candidates.add(name);
    }
  }

  return Array.from(candidates).slice(0, 20);
}

function collectCompanies(lines, headings, hints) {
  const candidates = new Set();
  const sources = [...hints, ...headings, ...lines.slice(0, 60)];

  for (const value of sources) {
    if (!value) {
      continue;
    }

    if (looksLikeCompany(value)) {
      candidates.add(value.replace(/\s{2,}/g, " ").trim());
    }
  }

  return Array.from(candidates).slice(0, 20);
}

function looksLikeCompany(value) {
  return /\b(inc|llc|ltd|limited|corp|corporation|company|group|studio|agency|solutions|technologies|tech|systems|labs|media|ventures)\b/i.test(
    value
  );
}

function extractSocialHandle(url) {
  if (/\/(sharer|share|intent\/|dialog\/|login|signup|redirect)/i.test(url)) {
    return null;
  }

  const patterns = [
    { label: "LinkedIn", regex: /linkedin\.com\/(?:in|company)\/([^/?#]+)/i },
    { label: "X", regex: /(?:twitter|x)\.com\/([^/?#]+)/i },
    { label: "Instagram", regex: /instagram\.com\/([^/?#]+)/i },
    { label: "Facebook", regex: /facebook\.com\/([^/?#]+)/i },
    { label: "TikTok", regex: /tiktok\.com\/@?([^/?#]+)/i },
    { label: "YouTube", regex: /youtube\.com\/(?:@|channel\/|c\/)?([^/?#]+)/i },
    { label: "Pinterest", regex: /pinterest\.com\/([^/?#]+)/i },
    { label: "Snapchat", regex: /snapchat\.com\/add\/([^/?#]+)/i },
    { label: "Telegram", regex: /t\.me\/([^/?#]+)/i },
    { label: "Threads", regex: /threads\.net\/@?([^/?#]+)/i },
    { label: "GitHub", regex: /github\.com\/([^/?#]+)/i }
  ];

  for (const { label, regex } of patterns) {
    const match = url.match(regex);
    if (match?.[1]) {
      return `${label}: ${decodeURIComponent(match[1])}`;
    }
  }

  return null;
}

function normalizePhone(value) {
  if (!value) return null;
  const cleaned = value.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
  let digits = cleaned.replace(/\D/g, "");
  
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  if (/^(?:0{7,}|1{7,}|2{7,}|3{7,}|4{7,}|5{7,}|6{7,}|7{7,}|8{7,}|9{7,})$/.test(digits)) {
    return null;
  }
  
  if (cleaned.startsWith('+')) {
    if (cleaned.startsWith('+234') && digits.length > 3 && digits[3] === '0') {
      digits = '234' + digits.substring(4);
    }
    return '+' + digits;
  }

  return digits;
}


function matchAll(input, regex) {
  return Array.from(input.matchAll(regex), (match) => match[0].trim());
}

function uniqueMatches(values) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildListingsFromParallelArrays(result) {
  const maxLength = Math.max(
    result.names.length,
    result.companyNames.length,
    result.phoneNumbers.length,
    result.whatsappNumbers.length,
    result.socialMediaHandles.length,
    result.emails.length,
    result.websites?.length || 0,
    result.addresses?.length || 0,
    0
  );

  const listings = [];

  for (let index = 0; index < maxLength; index += 1) {
    const row = {
      name: result.names[index] || "",
      companyName: result.companyNames[index] || "",
      phoneNumbers: result.phoneNumbers[index] ? [result.phoneNumbers[index]] : [],
      whatsappNumbers: result.whatsappNumbers[index] ? [result.whatsappNumbers[index]] : [],
      socialMediaHandles: result.socialMediaHandles[index] ? [result.socialMediaHandles[index]] : [],
      emails: result.emails[index] ? [result.emails[index]] : [],
      website: result.websites && result.websites[index] ? result.websites[index] : "",
      address: result.addresses && result.addresses[index] ? result.addresses[index] : ""
    };

    if (row.name || row.companyName || row.phoneNumbers.length || row.whatsappNumbers.length || row.socialMediaHandles.length || row.emails.length || row.website || row.address) {
      listings.push(row);
    }
  }

  return listings;
}

function cleanBusinessName(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(plus code|directions|website|call|share|save)\b.*$/i, "")
    .trim();
}

function isLikelyNoise(value) {
  const normalized = value.toLowerCase().trim();
  const exactMatches = ['results', 'google maps', 'menu', 'overview', 'about', 'home', 'directions', 'share', 'save'];
  if (exactMatches.includes(normalized)) return true;
  return value.length < 2;
}

function findListingContainer(node) {
  let current = node;

  while (current) {
    if (
      current.getAttribute?.("role") === "article" ||
      current.getAttribute?.("role") === "feed" ||
      current.dataset?.resultIndex !== undefined
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return node.parentElement || node;
}

function findMarketplaceContainer(node) {
  let current = node;

  while (current) {
    const role = current.getAttribute?.("role");
    const className = typeof current.className === "string" ? current.className : "";

    if (
      ["article", "listitem"].includes(role) ||
      ["ARTICLE", "LI"].includes(current.tagName) ||
      /card|result|listing|feed|search|srp-listing/i.test(className)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return node.parentElement || node;
}

function collectElementText(element) {
  if (!element) {
    return "";
  }

  const textParts = [element.innerText || ""];
  const ariaLabels = Array.from(element.querySelectorAll("[aria-label]"))
    .map((node) => node.getAttribute("aria-label") || "")
    .filter(Boolean);

  return [...textParts, ...ariaLabels].join(" ");
}

function collectVisibleText(element) {
  if (!element) {
    return "";
  }
  
  if (element.innerText) {
    return element.innerText.replace(/[ \t\r]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  }

  const clone = element.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, svg, img, video, iframe").forEach((node) => node.remove());
  return (clone.textContent || "").replace(/[ \t\r]+/g, " ").trim();
}

function createSanitizedDocument(doc) {
  const clone = doc.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, template, svg, canvas, iframe").forEach((node) => node.remove());
  return clone;
}

function extractPhonesFromText(text) {
  const allPhones = matchAll(text || "", /(?:\+?\d[\d\s().-]{6,}\d)/g);
  
  const naija1 = matchAll(text || "", /0[7-9]0\d{1}[\s.-]?\d{3}[\s.-]?\d{4}/g);
  const naija2 = matchAll(text || "", /0[1-9]\d{1}[\s.-]?\d{3}[\s.-]?\d{4}/g);
  
  return uniqueMatches([...allPhones, ...naija1, ...naija2].map(normalizePhone).filter(Boolean));
}

function extractWhatsappFromText(text) {
  const patterns = [
    /WhatsApp:?\s*(\+?\d[\d\s.-]{6,}\d)/gi,
    /WA:?\s*(\+?\d[\d\s.-]{6,}\d)/gi,
    /Chat (?:me |us )?on WhatsApp:?\s*(\+?\d[\d\s.-]{6,}\d)/gi,
    /Whatsapp (?:no|number|#):?\s*(\+?\d[\d\s.-]{6,}\d)/gi
  ];
  
  const extracted = [];
  for (const pattern of patterns) {
    const matches = Array.from((text || '').matchAll(pattern));
    for (const match of matches) {
      if (match[1]) extracted.push(match[1]);
    }
  }
  
  return extracted;
}

function extractAddressesFromText(text) {
  const addresses = [];
  
  const streetPattern = /\b\d{1,5}\s+[A-Za-z0-9.\-'\s]+(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Close|Crescent|Court|Ct|Highway|Hwy|Estate|Layout|Terrace|Mews|Place|Square|Circle|Loop|Trail|Parkway|Pkwy)\b[^|\n]{0,80}/gi;
  const matches = (text || '').match(streetPattern);
  if (matches) addresses.push(...matches);
  
  const poBoxPattern = /P\.?\s*O\.?\s*Box\s+\d+[^\n]{0,60}/gi;
  const poBoxMatches = (text || '').match(poBoxPattern);
  if (poBoxMatches) addresses.push(...poBoxMatches);
  
  return addresses.map(a => a.replace(/\s+/g, ' ').trim());
}

function extractEmailsFromText(text) {
  return uniqueMatches(matchAll(text || "", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi));
}

function extractWhatsappNumbersFromElement(element) {
  return uniqueMatches(
    Array.from(element?.querySelectorAll?.("a[href]") || [])
      .map((anchor) => anchor.href)
      .filter((href) => /wa\.me|whatsapp\.com/i.test(href))
      .map((href) => {
        const match = href.match(/(\+?\d[\d]{6,})/);
        return match ? normalizePhone(match[1]) : null;
      })
      .filter(Boolean)
  );
}

function extractSocialsFromElement(element) {
  return uniqueMatches(
    Array.from(element?.querySelectorAll?.("a[href]") || [])
      .map((anchor) => extractSocialHandle(anchor.href))
      .filter(Boolean)
  );
}

function firstMeaningfulLine(text) {
  return (text || "")
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .find((line) => line && line.length > 2 && line.length < 120);
}

function findSellerName(text) {
  const patterns = [
    /\bSeller[:\s]+([A-Z][^\n|,]{1,60})/i,
    /\bPosted by[:\s]+([A-Z][^\n|,]{1,60})/i,
    /\bMember[:\s]+([A-Z][^\n|,]{1,60})/i,
    /\bSeller info[:\s]*([A-Z][^\n|,]{1,60})/i,
    /\bSold by[:\s]+([A-Z][^\n|,]{1,60})/i,
    /\bVendor[:\s]+([A-Z][^\n|,]{1,60})/i,
    /\bShop name[:\s]+([^\n|,]{1,60})/i
  ];

  for (const pattern of patterns) {
    const match = (text || "").match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function looksLikeNavigationText(text) {
  return /\b(log in|sign up|privacy policy|terms of service|investor relations|recent activity)\b/i.test(text || "");
}

function finalizeMarketplaceResult(title, pageUrl, listings) {
  const cleanListings = listings.filter(
    (item) =>
      item &&
      (item.name ||
        item.companyName ||
        item.phoneNumbers?.length ||
        item.whatsappNumbers?.length ||
        item.socialMediaHandles?.length ||
        item.emails?.length ||
        item.website ||
        item.address)
  );

  return {
    page: {
      title: title || "",
      url: pageUrl
    },
    names: uniqueMatches(cleanListings.map((item) => item.name).filter(Boolean)),
    companyNames: uniqueMatches(cleanListings.map((item) => item.companyName).filter(Boolean)),
    phoneNumbers: uniqueMatches(cleanListings.flatMap((item) => item.phoneNumbers || [])),
    whatsappNumbers: uniqueMatches(cleanListings.flatMap((item) => item.whatsappNumbers || [])),
    socialMediaHandles: uniqueMatches(cleanListings.flatMap((item) => item.socialMediaHandles || [])),
    emails: uniqueMatches(cleanListings.flatMap((item) => item.emails || [])),
    websites: uniqueMatches(cleanListings.flatMap((item) => item.website ? [item.website] : [])),
    addresses: uniqueMatches(cleanListings.flatMap((item) => item.address ? [item.address] : [])),
    listings: cleanListings
  };
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value || "";
  }
}

function stripUrlHash(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeScrapeResult(result, tab = {}) {
  const safeResult = result && typeof result === "object" ? result : {};
  const safePage = safeResult.page && typeof safeResult.page === "object" ? safeResult.page : {};

  return {
    mode: safeResult.mode || "single-page",
    page: {
      title: safePage.title || tab.title || "Untitled Page",
      url: safePage.url || tab.url || ""
    },
    names: Array.isArray(safeResult.names) ? safeResult.names : [],
    companyNames: Array.isArray(safeResult.companyNames) ? safeResult.companyNames : [],
    phoneNumbers: Array.isArray(safeResult.phoneNumbers) ? safeResult.phoneNumbers : [],
    whatsappNumbers: Array.isArray(safeResult.whatsappNumbers) ? safeResult.whatsappNumbers : [],
    socialMediaHandles: Array.isArray(safeResult.socialMediaHandles) ? safeResult.socialMediaHandles : [],
    emails: Array.isArray(safeResult.emails) ? safeResult.emails : [],
    websites: Array.isArray(safeResult.websites) ? safeResult.websites : [],
    addresses: Array.isArray(safeResult.addresses) ? safeResult.addresses : [],
    listings: Array.isArray(safeResult.listings) ? safeResult.listings : [],
    crawlPages: Array.isArray(safeResult.crawlPages) ? safeResult.crawlPages : [],
    pagesScanned: Number.isInteger(safeResult.pagesScanned) ? safeResult.pagesScanned : 1,
    failedPages: Array.isArray(safeResult.failedPages) ? safeResult.failedPages : []
  };
}

function toCrawlPage(result) {
  return {
    pageTitle: result.page.title || "",
    sourceUrl: result.page.url || "",
    names: result.names,
    companyNames: result.companyNames,
    phoneNumbers: result.phoneNumbers,
    whatsappNumbers: result.whatsappNumbers,
    socialMediaHandles: result.socialMediaHandles,
    emails: result.emails,
    websites: result.websites,
    addresses: result.addresses,
    listings: Array.isArray(result.listings) ? result.listings : []
  };
}

function buildWebsiteAggregate(tab, crawlPages, failedPages) {
  const names = uniqueMatches(crawlPages.flatMap((item) => item.names));
  const companyNames = uniqueMatches(crawlPages.flatMap((item) => item.companyNames));
  const phoneNumbers = uniqueMatches(crawlPages.flatMap((item) => item.phoneNumbers));
  const whatsappNumbers = uniqueMatches(crawlPages.flatMap((item) => item.whatsappNumbers));
  const socialMediaHandles = uniqueMatches(crawlPages.flatMap((item) => item.socialMediaHandles));
  const emails = uniqueMatches(crawlPages.flatMap((item) => item.emails));
  const websites = uniqueMatches(crawlPages.flatMap((item) => item.websites));
  const addresses = uniqueMatches(crawlPages.flatMap((item) => item.addresses));
  
  const listings = dedupeListings(
    crawlPages.flatMap((item) => {
      if (Array.isArray(item.listings) && item.listings.length > 0) {
        return item.listings;
      }

      return [
        {
          name: item.names.join(", "),
          companyName: item.companyNames.join(", "),
          phoneNumbers: item.phoneNumbers,
          whatsappNumbers: item.whatsappNumbers,
          socialMediaHandles: item.socialMediaHandles,
          emails: item.emails,
          website: (item.websites || [])[0] || "",
          address: (item.addresses || [])[0] || "",
          sourceUrl: item.sourceUrl,
          pageTitle: item.pageTitle
        }
      ];
    })
  );

  return normalizeScrapeResult(
    {
      mode: "website-crawl",
      page: {
        title: tab.title || "Website Crawl",
        url: tab.url || ""
      },
      names,
      companyNames,
      phoneNumbers,
      whatsappNumbers,
      socialMediaHandles,
      emails,
      websites,
      addresses,
      listings,
      crawlPages,
      pagesScanned: crawlPages.length,
      failedPages
    },
    tab
  );
}

function dedupeListings(listings) {
  const map = new Map();

  for (const listing of listings) {
    const key = `${listing.sourceUrl || ""}|${listing.companyName || ""}|${listing.name || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        ...listing,
        phoneNumbers: uniqueMatches(listing.phoneNumbers || []),
        whatsappNumbers: uniqueMatches(listing.whatsappNumbers || []),
        socialMediaHandles: uniqueMatches(listing.socialMediaHandles || []),
        emails: uniqueMatches(listing.emails || []),
        website: listing.website || "",
        address: listing.address || ""
      });
      continue;
    }

    const current = map.get(key);
    current.phoneNumbers = uniqueMatches([...(current.phoneNumbers || []), ...(listing.phoneNumbers || [])]);
    current.whatsappNumbers = uniqueMatches([...(current.whatsappNumbers || []), ...(listing.whatsappNumbers || [])]);
    current.socialMediaHandles = uniqueMatches([...(current.socialMediaHandles || []), ...(listing.socialMediaHandles || [])]);
    current.emails = uniqueMatches([...(current.emails || []), ...(listing.emails || [])]);
    current.website = current.website || listing.website || "";
    current.address = current.address || listing.address || "";
  }

  return Array.from(map.values()).filter(
    (item) =>
      item.name ||
      item.companyName ||
      item.phoneNumbers.length ||
      item.whatsappNumbers.length ||
      item.socialMediaHandles.length ||
      item.emails.length ||
      item.website ||
      item.address
  );
}

function countNonEmptyListingField(listings, fieldName, fallback) {
  if (!Array.isArray(listings) || listings.length === 0) {
    return fallback;
  }

  return listings.reduce((total, item) => {
    if (Array.isArray(item[fieldName])) return total + (item[fieldName].length ? 1 : 0);
    return total + (item[fieldName] ? 1 : 0);
  }, 0);
}


if (!window.__edgescraper_listener_added) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapePage') {
      scrapePage(request.options || {}).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;
    }
    if (request.action === 'collectCandidateLinks') {
      sendResponse(collectCandidateLinks());
    }
  });
  window.__edgescraper_listener_added = true;
}
