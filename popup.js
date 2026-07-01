const scrapeButton = document.getElementById("scrapeButton");
const scrapeWebsiteButton = document.getElementById("scrapeWebsiteButton");
const scrapeWaButton = document.getElementById("scrapeWaButton");

const copyButton = document.getElementById("copyButton");
const exportButton = document.getElementById("exportButton");
const statusNode = document.getElementById("status");
const outputNode = document.getElementById("output");
const summaryNode = document.getElementById("summary");

const waConfigPanel = document.getElementById("waConfigPanel");
const waTarget = document.getElementById("waTarget");
const waAutoScroll = document.getElementById("waAutoScroll");
const waStartScrapeBtn = document.getElementById("waStartScrapeBtn");
const waCancelBtn = document.getElementById("waCancelBtn");

const geminiToggle = document.getElementById("geminiToggle");
const geminiKeyInput = document.getElementById("geminiKeyInput");
const saveGeminiKeyBtn = document.getElementById("saveGeminiKeyBtn");
const clearGeminiKeyBtn = document.getElementById("clearGeminiKeyBtn");
const geminiKeyStatus = document.getElementById("geminiKeyStatus");

const backendSelect = document.getElementById("backendSelect");

const WEBSITE_PAGE_LIMIT = 12;
const CLOUD_API_BASE = "https://edgewebscraper-backend.onrender.com";

let lastResult = null;

scrapeButton.addEventListener("click", async () => {
  setStatus("Scraping current page...");
  setBusy("page", true);

  try {
    const tab = await getActiveTab();
    const result = await scrapeCurrentPage(tab);

    lastResult = result;
    outputNode.value = JSON.stringify(result, null, 2);
    renderSummary(result);
    setResultActionsEnabled(true);
    setStatus(`Scraped ${result.page.title || "page"} successfully.`);
  } catch (error) {
    clearResult(error.message || "Scrape failed.");
  } finally {
    setBusy("page", false);
  }
});

scrapeWaButton.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    if (!tab.url.includes("web.whatsapp.com")) {
      setStatus("Error: Please open WhatsApp Web first.");
      return;
    }
    waConfigPanel.classList.remove("hidden");
  } catch (e) {
    setStatus("Error checking tab.");
  }
});

waCancelBtn.addEventListener("click", () => {
  waConfigPanel.classList.add("hidden");
});

waStartScrapeBtn.addEventListener("click", async () => {
  waConfigPanel.classList.add("hidden");
  setStatus("Scraping WhatsApp contacts...");
  setBusy("page", true);

  try {
    const tab = await getActiveTab();
    const result = await sendMessageWithInjection(tab.id, {
      action: "scrapePage",
      options: {
        waTarget: waTarget.value,
        waAutoScroll: waAutoScroll.checked
      }
    });

    if (result && result.error) throw new Error(result.error);

    lastResult = normalizeScrapeResult(result, tab);
    renderSummary(lastResult);
    outputNode.value = JSON.stringify(lastResult, null, 2);
    setResultActionsEnabled(true);
    setStatus("Scraping complete.");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
    clearResult();
    alert(`Scraping Failed:\n\n${error.message}`);
  } finally {
    setBusy("page", false);
  }
});



scrapeWebsiteButton.addEventListener("click", async () => {
  setStatus("Crawling website...");
  setBusy("website", true);

  try {
    const tab = await getActiveTab();
    const result = await crawlWebsite(tab);

    lastResult = result;
    outputNode.value = JSON.stringify(result, null, 2);
    renderSummary(result);
    setResultActionsEnabled(true);
    setStatus(`Scanned ${result.pagesScanned} page(s) on this website.`);
  } catch (error) {
    clearResult(error.message || "Website crawl failed.");
  } finally {
    setBusy("website", false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!lastResult) {
    return;
  }

  await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
  setStatus("Copied JSON to clipboard.");
});

exportButton.addEventListener("click", async () => {
  if (!lastResult) {
    return;
  }

  try {
    const workbookBytes = buildWorkbook(lastResult);
    const blob = new Blob([workbookBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = sanitizeFileName(lastResult.page.title || "scraped-page");

    link.href = url;
    link.download = `${safeTitle}-contacts.xlsx`;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setStatus("Exported XLSX file.");
  } catch (error) {
    setStatus(error.message || "XLSX export failed.");
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab;
}

async function sendMessageWithInjection(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (error.message.includes("Receiving end does not exist")) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["scraper.js"]
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return await chrome.tabs.sendMessage(tabId, message);
    }
    throw error;
  }
}

function isFacebookUrl(url) {
  try { return /facebook\.com/i.test(new URL(url).hostname); } catch { return false; }
}

function isFacebookRootOrFeed(url) {
  try {
    const parsed = new URL(url);
    if (!/facebook\.com/i.test(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '');
    return path === '' || path === '/home.php' || path === '/feed' || path === '/login' || path === '/watch' || path === '/stories';
  } catch {
    return false;
  }
}

async function scrapeCurrentPage(tab) {
  if (isFacebookUrl(tab.url)) {
    if (isFacebookRootOrFeed(tab.url)) {
      throw new Error("You are on the Facebook Home Feed / Main Page. Please navigate to a specific Facebook Business Page or Profile to scrape contact information.");
    }
    if (backendSelect && backendSelect.value === "cloud") {
      throw new Error("Facebook blocks automated Cloud server scraping. Please switch 'Scrape Engine' to '💻 Local Browser' to scrape Facebook directly from your active browser tab.");
    }
  }

  if (/google\.[a-z.]+\/search|bing\.com\/search/i.test(tab.url || "")) {
    if (backendSelect && backendSelect.value === "cloud") {
      throw new Error("Google/Bing search engines block automated Cloud server requests. Please switch 'Scrape Engine' to '💻 Local Browser' to scrape search results directly from your active browser tab.");
    }
  }

  if (backendSelect && backendSelect.value === "cloud") {
    return await scrapeViaCloud(tab, "single");
  }

  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(["gemini_api_key", "gemini_enabled"], resolve);
  });

  const result = await sendMessageWithInjection(tab.id, {
    action: "scrapePage",
    options: {
      geminiEnabled: !!settings.gemini_enabled,
      geminiApiKey: settings.gemini_api_key || ""
    }
  });
  if (result && result.error) throw new Error(result.error);
  return normalizeScrapeResult(result, tab);
}

async function crawlWebsite(tab) {
  if (backendSelect && backendSelect.value === "cloud") {
    return await scrapeViaCloud(tab, "crawl");
  }
  const currentPageResult = await scrapeCurrentPage(tab);
  
  if (/google\.com\/maps/i.test(tab.url || "")) {
    return {
      mode: "website-crawl",
      page: { title: tab.title, url: tab.url },
      names: currentPageResult.names,
      companyNames: currentPageResult.companyNames,
      phoneNumbers: currentPageResult.phoneNumbers,
      whatsappNumbers: currentPageResult.whatsappNumbers,
      socialMediaHandles: currentPageResult.socialMediaHandles,
      emails: currentPageResult.emails,
      websites: currentPageResult.websites,
      addresses: currentPageResult.addresses,
      listings: currentPageResult.listings || [],
      crawlPages: [toCrawlPage(currentPageResult)],
      pagesScanned: 1,
      failedPages: []
    };
  }

  const rawLinks = await sendMessageWithInjection(tab.id, { action: "collectCandidateLinks" });

  const queue = isSupportedMarketplaceUrl(tab.url)
    ? buildMarketplaceQueue(rawLinks || [], tab.url)
    : buildWebsiteQueue(rawLinks || [], tab.url);
  const crawlPages = [toCrawlPage(currentPageResult)];
  const failedPages = [];

  for (let index = 0; index < queue.length && crawlPages.length < WEBSITE_PAGE_LIMIT; index += 1) {
    const pageUrl = queue[index];
    setStatus(`Crawling page ${crawlPages.length + 1} of ${Math.min(queue.length + 1, WEBSITE_PAGE_LIMIT)}...`);

    try {
      const pageResult = await scrapeFetchedPage(pageUrl);
      crawlPages.push(toCrawlPage(pageResult));
    } catch (error) {
      failedPages.push({ url: pageUrl, error: error.message || "Fetch failed." });
    }
  }

  return buildWebsiteAggregate(tab, crawlPages, failedPages);
}

async function scrapeFetchedPage(pageUrl) {
  const response = await fetch(pageUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pageUrl}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Skipped non-HTML page: ${pageUrl}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(["gemini_api_key", "gemini_enabled"], resolve);
  });

  const rawScrape = await scrapeGenericDocument(doc, pageUrl, {
    geminiEnabled: !!settings.gemini_enabled,
    geminiApiKey: settings.gemini_api_key || ""
  });

  return normalizeScrapeResult(rawScrape, {
    title: doc.title,
    url: pageUrl
  });
}

function setBusy(mode, isBusy) {
  if (mode === "page") {
    scrapeButton.disabled = isBusy;
    scrapeButton.textContent = isBusy ? "Scraping..." : "Scrape This Page";
    scrapeWebsiteButton.disabled = isBusy;
  } else {
    scrapeWebsiteButton.disabled = isBusy;
    scrapeWebsiteButton.textContent = isBusy ? "Crawling..." : "Scrape Website";
    scrapeButton.disabled = isBusy;
  }
}

function setResultActionsEnabled(isEnabled) {
  copyButton.disabled = !isEnabled;
  exportButton.disabled = !isEnabled;
}

function clearResult(message) {
  lastResult = null;
  outputNode.value = "";
  renderSummary(null);
  setResultActionsEnabled(false);
  setStatus(message);
}

function setStatus(message) {
  statusNode.textContent = message;
}

function renderSummary(result) {
  const counts = result
    ? {
        names: result.listings.length || result.names.length,
        companies: result.listings.length || result.companyNames.length,
        phones: countNonEmptyListingField(result.listings, "phoneNumbers", result.phoneNumbers.length),
        whatsapp: countNonEmptyListingField(result.listings, "whatsappNumbers", result.whatsappNumbers.length),
        emails: countNonEmptyListingField(result.listings, "emails", result.emails.length),
        socials: countNonEmptyListingField(result.listings, "socialMediaHandles", result.socialMediaHandles.length),
        websites: countNonEmptyListingField(result.listings, "website", result.websites?.length || 0),
        addresses: countNonEmptyListingField(result.listings, "address", result.addresses?.length || 0)
      }
    : {
        names: 0,
        companies: 0,
        phones: 0,
        whatsapp: 0,
        emails: 0,
        socials: 0,
        websites: 0,
        addresses: 0
      };

  const values = Array.from(summaryNode.querySelectorAll("dd"));
  if (values.length >= 8) {
    values[0].textContent = counts.names;
    values[1].textContent = counts.companies;
    values[2].textContent = counts.phones;
    values[3].textContent = counts.whatsapp;
    values[4].textContent = counts.emails;
    values[5].textContent = counts.socials;
    values[6].textContent = counts.websites;
    values[7].textContent = counts.addresses;
  }
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

async function scrapeViaCloud(tab, mode = "single") {
  setStatus("Connecting to Cloud Scraper (Render)...");

  const submitRes = await fetch(`${CLOUD_API_BASE}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: tab.url,
      mode: mode,
      max_pages: WEBSITE_PAGE_LIMIT
    })
  });

  if (!submitRes.ok) {
    const errData = await submitRes.json().catch(() => ({}));
    throw new Error(errData.detail || `Cloud server error (${submitRes.status})`);
  }

  const { job_id } = await submitRes.json();
  setStatus(`Cloud job submitted (${job_id}). Running spider on Render...`);

  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const statusRes = await fetch(`${CLOUD_API_BASE}/api/scrape/${job_id}`);
    if (!statusRes.ok) continue;

    const job = await statusRes.json();
    if (job.status === "running") {
      setStatus(job.progress || "Cloud spider active on Render...");
    } else if (job.status === "completed") {
      return formatCloudResults(job, tab);
    } else if (job.status === "failed") {
      throw new Error(job.error || "Cloud scrape job failed on server.");
    }
  }

  throw new Error("Job timed out waiting for cloud server response.");
}

function formatCloudResults(job, tab) {
  const listings = job.listings || [];
  const names = [];
  const companyNames = [];
  const phoneNumbers = [];
  const whatsappNumbers = [];
  const socialMediaHandles = [];
  const emails = [];
  const websites = [];
  const addresses = [];

  listings.forEach((item) => {
    if (item.name) names.push(item.name);
    if (item.company_name) companyNames.push(item.company_name);
    if (Array.isArray(item.phone_numbers)) phoneNumbers.push(...item.phone_numbers);
    if (Array.isArray(item.whatsapp_numbers)) whatsappNumbers.push(...item.whatsapp_numbers);
    if (Array.isArray(item.social_media_handles)) socialMediaHandles.push(...item.social_media_handles);
    if (Array.isArray(item.emails)) emails.push(...item.emails);
    if (item.website) websites.push(item.website);
    if (item.address) addresses.push(item.address);
  });

  return {
    mode: job.mode,
    page: { title: tab.title || job.url, url: tab.url },
    names: [...new Set(names)],
    companyNames: [...new Set(companyNames)],
    phoneNumbers: [...new Set(phoneNumbers)],
    whatsappNumbers: [...new Set(whatsappNumbers)],
    socialMediaHandles: [...new Set(socialMediaHandles)],
    emails: [...new Set(emails)],
    websites: [...new Set(websites)],
    addresses: [...new Set(addresses)],
    listings: listings,
    pagesScanned: job.total_listings || 1,
    failedPages: []
  };
}

// ── Gemini AI settings & Event Handlers ─────────────────────────────────────
chrome.storage.local.get(["gemini_api_key", "gemini_enabled"], (data) => {
  if (data.gemini_api_key) {
    geminiKeyInput.value = data.gemini_api_key;
    updateGeminiStatus(true);
  } else {
    updateGeminiStatus(false);
  }
  geminiToggle.checked = !!data.gemini_enabled;
});

geminiToggle.addEventListener("change", () => {
  const enabled = geminiToggle.checked;
  chrome.storage.local.set({ gemini_enabled: enabled });
  
  if (enabled) {
    chrome.storage.local.get(["gemini_api_key"], (data) => {
      if (!data.gemini_api_key) {
        geminiKeyStatus.textContent = "Please enter and save your API key first.";
        geminiKeyStatus.className = "key-status error";
      }
    });
  }
});

saveGeminiKeyBtn.addEventListener("click", () => {
  const key = geminiKeyInput.value.trim();
  if (!key) {
    geminiKeyStatus.textContent = "API key cannot be empty.";
    geminiKeyStatus.className = "key-status error";
    return;
  }
  
  chrome.storage.local.set({ gemini_api_key: key }, () => {
    updateGeminiStatus(true);
    geminiKeyStatus.textContent = "API Key saved successfully!";
    geminiKeyStatus.className = "key-status success";
    setTimeout(() => {
      geminiKeyStatus.textContent = "";
    }, 2000);
  });
});

clearGeminiKeyBtn.addEventListener("click", () => {
  geminiKeyInput.value = "";
  chrome.storage.local.remove(["gemini_api_key"], () => {
    updateGeminiStatus(false);
    geminiKeyStatus.textContent = "API Key cleared.";
    geminiKeyStatus.className = "key-status error";
    setTimeout(() => {
      geminiKeyStatus.textContent = "";
    }, 2000);
  });
});

function updateGeminiStatus(hasKey) {
  if (hasKey) {
    saveGeminiKeyBtn.textContent = "Update";
  } else {
    saveGeminiKeyBtn.textContent = "Save";
  }
}



