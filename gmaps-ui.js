// gmaps-ui.js — Embedded Google Maps Scraper Widget
// Injected into Google Maps pages. Provides persistent floating UI with progress tracking.
// Calls window.scrapeGoogleMaps() from gmaps-scraper.js

(function () {
  "use strict";
  if (document.getElementById("edgescraper-gmaps-root")) return;

  // ─── Build Widget HTML ──────────────────────────────────────────────────────

  var root = document.createElement("div");
  root.id = "edgescraper-gmaps-root";
  root.innerHTML = [
    '<div id="edgescraper-gmaps-widget">',
    '  <div id="edgescraper-gmaps-header">',
    '    <div class="edgescraper-header-title">',
    '      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">',
    '        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/>',
    "      </svg>",
    "      Edge Maps Scraper",
    "    </div>",
    '    <button id="edgescraper-gmaps-toggle">\u25BC</button>',
    "  </div>",
    '  <div id="edgescraper-gmaps-body">',
    '    <div id="edgescraper-gmaps-status">Ready. Search for something and click Start!</div>',
    "",
    '    <div id="edgescraper-gmaps-progress-wrap" class="edgescraper-hidden">',
    '      <div id="edgescraper-gmaps-progress-bar"></div>',
    "    </div>",
    '    <div id="edgescraper-gmaps-progress-label" class="edgescraper-hidden"></div>',
    "",
    '    <div id="edgescraper-gmaps-summary" class="edgescraper-hidden">',
    '      <div class="edgescraper-stat"><div class="edgescraper-stat-val" id="gmaps-stat-total">0</div><div class="edgescraper-stat-lbl">Total</div></div>',
    '      <div class="edgescraper-stat"><div class="edgescraper-stat-val" id="gmaps-stat-phones">0</div><div class="edgescraper-stat-lbl">Phones</div></div>',
    '      <div class="edgescraper-stat"><div class="edgescraper-stat-val" id="gmaps-stat-emails">0</div><div class="edgescraper-stat-lbl">Emails</div></div>',
    '      <div class="edgescraper-stat"><div class="edgescraper-stat-val" id="gmaps-stat-websites">0</div><div class="edgescraper-stat-lbl">Websites</div></div>',
    '      <div class="edgescraper-stat"><div class="edgescraper-stat-val" id="gmaps-stat-socials">0</div><div class="edgescraper-stat-lbl">Socials</div></div>',
    "    </div>",
    "",
    '    <div class="edgescraper-row">',
    "      <label>Max Results</label>",
    '      <select id="gmaps-opt-depth">',
    '        <option value="20">Quick (~20)</option>',
    '        <option value="60" selected>Standard (~60)</option>',
    '        <option value="120">Deep (~120)</option>',
    '        <option value="0">Unlimited</option>',
    "      </select>",
    "    </div>",
    '    <div class="edgescraper-row">',
    '      <label class="edgescraper-checkbox">',
    '        <input type="checkbox" id="gmaps-opt-deep" checked>',
    "        Deep Scrape (fetch details + emails from websites)",
    "      </label>",
    "    </div>",
    "",
    '    <button id="gmaps-btn-start" class="edgescraper-btn edgescraper-btn-primary">Start Scraping</button>',
    '    <button id="gmaps-btn-stop" class="edgescraper-btn edgescraper-btn-danger edgescraper-hidden">Stop</button>',
    '    <button id="gmaps-btn-export" class="edgescraper-btn edgescraper-btn-success edgescraper-hidden">Export XLSX</button>',
    "  </div>",
    "</div>",
  ].join("\n");

  document.body.appendChild(root);

  // ─── UI Elements ────────────────────────────────────────────────────────────

  var widget = document.getElementById("edgescraper-gmaps-widget");
  var header = document.getElementById("edgescraper-gmaps-header");
  var toggleBtn = document.getElementById("edgescraper-gmaps-toggle");
  var statusEl = document.getElementById("edgescraper-gmaps-status");
  var summaryEl = document.getElementById("edgescraper-gmaps-summary");
  var progressWrap = document.getElementById("edgescraper-gmaps-progress-wrap");
  var progressBar = document.getElementById("edgescraper-gmaps-progress-bar");
  var progressLabel = document.getElementById("edgescraper-gmaps-progress-label");
  var startBtn = document.getElementById("gmaps-btn-start");
  var stopBtn = document.getElementById("gmaps-btn-stop");
  var exportBtn = document.getElementById("gmaps-btn-export");
  var optDepth = document.getElementById("gmaps-opt-depth");
  var optDeep = document.getElementById("gmaps-opt-deep");

  var statTotal = document.getElementById("gmaps-stat-total");
  var statPhones = document.getElementById("gmaps-stat-phones");
  var statEmails = document.getElementById("gmaps-stat-emails");
  var statWebsites = document.getElementById("gmaps-stat-websites");
  var statSocials = document.getElementById("gmaps-stat-socials");

  var isMinimized = false;
  var currentBusinesses = null;
  var isScraping = false;
  var scrapeSignal = null;

  // ─── Toggle Minimize ────────────────────────────────────────────────────────

  header.addEventListener("click", function () {
    isMinimized = !isMinimized;
    if (isMinimized) {
      widget.classList.add("minimized");
      toggleBtn.textContent = "\u25B2";
    } else {
      widget.classList.remove("minimized");
      toggleBtn.textContent = "\u25BC";
    }
  });

  // ─── UI Helpers ─────────────────────────────────────────────────────────────

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function setProgress(percent, label) {
    progressWrap.classList.remove("edgescraper-hidden");
    progressLabel.classList.remove("edgescraper-hidden");
    progressBar.style.width = Math.min(100, Math.max(0, percent)) + "%";
    if (label) progressLabel.textContent = label;
  }

  function hideProgress() {
    progressWrap.classList.add("edgescraper-hidden");
    progressLabel.classList.add("edgescraper-hidden");
  }

  function updateStats(stats) {
    summaryEl.classList.remove("edgescraper-hidden");
    statTotal.textContent = stats.total || 0;
    statPhones.textContent = stats.phones || 0;
    statEmails.textContent = stats.emails || 0;
    statWebsites.textContent = stats.websites || 0;
    statSocials.textContent = stats.socials || 0;
  }

  function savePartialResults(businesses) {
    if (!Array.isArray(businesses) || businesses.length === 0) return;
    currentBusinesses = businesses.slice();
    exportBtn.classList.remove("edgescraper-hidden");
  }

  // ─── Start Scraping ─────────────────────────────────────────────────────────

  startBtn.addEventListener("click", async function () {
    if (isScraping) return;
    isScraping = true;
    scrapeSignal = { cancelled: false };

    startBtn.disabled = true;
    startBtn.classList.add("edgescraper-hidden");
    stopBtn.classList.remove("edgescraper-hidden");
    exportBtn.classList.add("edgescraper-hidden");
    currentBusinesses = null;

    var maxResults = parseInt(optDepth.value, 10);
    var deepScrape = optDeep.checked;

    setStatus("Starting...");
    setProgress(0, "Initializing...");

    try {
      if (typeof window.scrapeGoogleMaps !== "function") {
        throw new Error("Scraper engine not loaded. Try reloading the page.");
      }

      var businesses = await window.scrapeGoogleMaps(
        {
          maxResults: maxResults,
          deepScrape: deepScrape,
          signal: scrapeSignal,
        },
        {
          onStatus: setStatus,
          onProgress: setProgress,
          onStats: updateStats,
          onPartial: savePartialResults,
        }
      );

      currentBusinesses = businesses;

      if (businesses.length > 0) {
        exportBtn.classList.remove("edgescraper-hidden");
      }
    } catch (e) {
      if (scrapeSignal && scrapeSignal.cancelled) {
        setStatus("Stopped. Export is available if any results completed.");
      } else {
        setStatus("Error: " + e.message);
      }
    } finally {
      isScraping = false;
      scrapeSignal = null;
      stopBtn.disabled = false;
      startBtn.disabled = false;
      startBtn.classList.remove("edgescraper-hidden");
      stopBtn.classList.add("edgescraper-hidden");
      hideProgress();
    }
  });

  stopBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    if (!scrapeSignal) return;
    scrapeSignal.cancelled = true;
    stopBtn.disabled = true;
    setStatus("Stopping after the current request...");
  });

  // ─── Export XLSX ────────────────────────────────────────────────────────────

  exportBtn.addEventListener("click", function () {
    if (!currentBusinesses || currentBusinesses.length === 0) return;

    try {
      setStatus("Generating Excel file...");

      if (typeof buildGoogleMapsWorkbook !== "function") {
        throw new Error("Excel engine not loaded. Try reloading the page.");
      }

      var bytes = buildGoogleMapsWorkbook(currentBusinesses, document.title);
      var blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      var safeName = (document.title || "google-maps-scraped")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
        .replace(/\s+/g, "-")
        .slice(0, 80);

      link.href = url;
      link.download = safeName + "-contacts.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      setStatus("Exported " + currentBusinesses.length + " businesses to XLSX!");
    } catch (e) {
      setStatus("Export Error: " + e.message);
    }
  });
})();
