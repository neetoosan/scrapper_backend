const fs = require('fs');

const content = fs.readFileSync('C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/leads.33566aa6.js', 'utf8');

// Match typical Google Maps class names like .Nv2PK, .hfpxzc, [aria-label="..."]
const classMatches = content.match(/['"]\.[A-Za-z0-9_-]{4,}['"]/g) || [];
const attrMatches = content.match(/['"]\[[a-zA-Z-]+(?:=["'][^"']+["'])?\]['"]/g) || [];
const combinedMatches = content.match(/['"][a-zA-Z0-9_.-]+\[[a-zA-Z-]+\]['"]/g) || [];

const allSelectors = [...new Set([...classMatches, ...attrMatches, ...combinedMatches])];

console.log("Potential DOM Selectors used in extension:");
console.log(allSelectors.filter(s => !s.includes('.js') && !s.includes('.css') && !s.includes('.json')));

// Let's also look for URL endpoints it fetches
const apiEndpoints = content.match(/https?:\/\/[^\s"'`]+api[^\s"'`]+/gi) || [];
console.log("\nAPI Endpoints:");
console.log([...new Set(apiEndpoints)]);
