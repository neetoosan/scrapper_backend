const fs = require('fs');
const content = fs.readFileSync('C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/leads.33566aa6.js', 'utf8');

// Find all URLs
const urls = content.match(/https?:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9.\-_\/]+/g);
if (urls) {
  const uniqueUrls = [...new Set(urls)].filter(u => u.includes('google'));
  console.log("Google URLs found in extension:", uniqueUrls);
}

// Find string literals that look like query selectors starting with a dot
const dotSelectors = content.match(/['"](\.[a-zA-Z0-9_-]+)+['"]/g);
if (dotSelectors) {
  console.log("Class selectors:", [...new Set(dotSelectors)].slice(0, 20));
}

// Check for network interception (XHR/Fetch overriding)
console.log("Overrides fetch?", content.includes('window.fetch =') || content.includes('fetch ='));
console.log("Overrides XHR?", content.includes('XMLHttpRequest.prototype.open'));
