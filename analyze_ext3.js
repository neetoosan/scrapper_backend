const fs = require('fs');

const file1 = 'C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/leads.33566aa6.js';
const content = fs.readFileSync(file1, 'utf8');

// Find JSON-like object shapes or field assignments
const keys = ['phone', 'website', 'address', 'reviews', 'rating', 'title', 'latitude', 'longitude'];
const assignments = new Set();

// Basic regex to find something like `phone:` or `"phone":` or `address:` etc
for (const key of keys) {
  const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*([^,;\\}]+)`, 'gi');
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1].length < 100) {
      assignments.add(`${key}: ${match[1].trim()}`);
    }
  }
}

fs.writeFileSync('C:/Users/HP/Documents/work/edgewebscraper/ext_analysis.txt', Array.from(assignments).join('\n'));
console.log(`Wrote ${assignments.size} assignments to ext_analysis.txt`);
