// MV3 service worker for cross-origin page fetching.

var lastFetchTime = 0;
var MIN_FETCH_INTERVAL = 150;
var FETCH_TIMEOUT_MS = 8000;

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function () {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    var response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleFetchWebsite(request) {
  if (!request || !request.url || !/^https?:\/\//i.test(request.url)) {
    return { success: false, error: "Invalid URL" };
  }

  var now = Date.now();
  var delay = Math.max(0, MIN_FETCH_INTERVAL - (now - lastFetchTime));
  if (delay > 0) {
    await wait(delay);
  }

  lastFetchTime = Date.now();
  var html = await fetchWithTimeout(request.url);
  return { success: true, html: html };
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || request.action !== "fetchWebsite") {
    return false;
  }

  handleFetchWebsite(request)
    .then(function (result) {
      sendResponse(result);
    })
    .catch(function (error) {
      sendResponse({
        success: false,
        error: error && error.message ? error.message : String(error),
      });
    });

  return true;
});
