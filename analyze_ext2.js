const fs = require('fs');

const file1 = 'C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/leads.33566aa6.js';

function analyzeSelectors(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  
  // Find strings that look like CSS selectors used in querySelector or querySelectorAll
  const selectorRegex = /querySelector(?:All)?\(\s*["']([^"']+)["']/g;
  let match;
  const selectors = new Set();
  
  while ((match = selectorRegex.exec(content)) !== null) {
    selectors.add(match[1]);
  }
  
  console.log("Selectors found:", Array.from(selectors));

  // Search for anything looking like data-item-id or specific class names common in gmaps
  const interestingClasses = content.match(/\b([A-Za-z0-9_-]{5,})\b/g);
  // Just search for "maps" related URLs
  const mapsUrls = content.match(/https?:\/\/[^"'\s]+\/maps[^"'\s]*/g);
  console.log("Maps URLs:", [...new Set(mapsUrls)]);
}

analyzeSelectors(file1);
