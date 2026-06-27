// interceptor.js
// Injected into the main world of Google Maps to intercept network responses.
// Captures structured data from Google's proprietary API responses.

(function() {
  if (window.__gmaps_interceptor_installed) return;
  window.__gmaps_interceptor_installed = true;

  // Patterns that indicate Google Maps business data responses
  const INTERCEPT_PATTERNS = [
    '/search',
    '/batchexecute',
    '/preview/place',
    '/maps/api/',
    '/maps/rpc/',
    '/locationhistory/'
  ];

  function shouldIntercept(url) {
    if (!url) return false;
    return INTERCEPT_PATTERNS.some(p => url.includes(p));
  }

  function forwardPayload(url, text) {
    try {
      if (!text || text.length < 50) return;
      window.postMessage({
        type: 'EDGESCRAPER_INTERCEPT',
        url: url,
        text: text
      }, '*');
    } catch (e) {}
  }

  // === Intercept XMLHttpRequest ===
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._interceptUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        if (shouldIntercept(this._interceptUrl)) {
          forwardPayload(this._interceptUrl, this.responseText);
        }
      } catch (e) {}
    });
    return originalSend.apply(this, arguments);
  };

  // === Intercept Fetch API ===
  const originalFetch = window.fetch;
  window.fetch = async function() {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = arguments[0] instanceof Request ? arguments[0].url : String(arguments[0]);
      if (shouldIntercept(url)) {
        const clone = response.clone();
        const text = await clone.text();
        forwardPayload(url, text);
      }
    } catch (e) {}
    return response;
  };
})();
