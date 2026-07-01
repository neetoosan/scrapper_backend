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

async function handleCleanWithGemini(request) {
  if (!request.apiKey) {
    throw new Error("Missing Gemini API Key. Please save your key in settings.");
  }
  if (!request.text) {
    throw new Error("No page text found to analyze.");
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + request.apiKey;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "You are an expert data scraper. Extract all business listings, personal leads, contact details, organization details, emails, phones, and addresses from the following webpage content.\n\nDo NOT extract generic templates, placeholder links, layout text, navigation items, tracking IDs (such as max integers like 2147483648 or digit sequences like 0123456789), or standard template text. Ensure you only extract real, actual business contacts or personal leads.\n\nHere is the webpage content:\n---\n" + request.text + "\n---"
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            listings: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  companyName: { type: "STRING" },
                  phoneNumbers: { type: "ARRAY", items: { type: "STRING" } },
                  whatsappNumbers: { type: "ARRAY", items: { type: "STRING" } },
                  socialMediaHandles: { type: "ARRAY", items: { type: "STRING" } },
                  emails: { type: "ARRAY", items: { type: "STRING" } },
                  website: { type: "STRING" },
                  address: { type: "STRING" },
                  category: { type: "STRING" }
                },
                required: ["name"]
              }
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorDetails = await response.json().catch(() => ({}));
    const message = (errorDetails.error && errorDetails.error.message) || ("HTTP " + response.status);
    throw new Error("Gemini API Error: " + message);
  }

  const data = await response.json();
  const textResponse = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!textResponse) {
    throw new Error("Empty response from Gemini AI.");
  }

  return JSON.parse(textResponse);
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || !request.action) {
    return false;
  }

  if (request.action === "fetchWebsite") {
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
  }

  if (request.action === "cleanWithGemini") {
    handleCleanWithGemini(request)
      .then(function (result) {
        sendResponse({ success: true, data: result });
      })
      .catch(function (error) {
        sendResponse({
          success: false,
          error: error && error.message ? error.message : String(error),
        });
      });
    return true;
  }

  return false;
});
