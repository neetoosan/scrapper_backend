const fs = require('fs');

const file1 = 'C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/leads.33566aa6.js';
const file2 = 'C:/Users/HP/Downloads/google-maps-scraper-v2.5.9/background.5fadff2f.js';

function searchFile(filepath, queries) {
  const content = fs.readFileSync(filepath, 'utf8');
  console.log(`\n=== Searching ${filepath} ===`);
  queries.forEach(q => {
    const idx = content.indexOf(q);
    if (idx !== -1) {
      console.log(`Found "${q}" at ${idx}`);
      // Print context
      const start = Math.max(0, idx - 100);
      const end = Math.min(content.length, idx + 100);
      console.log(`Context: ...${content.substring(start, end)}...`);
    } else {
      console.log(`"${q}" not found.`);
    }
  });
}

const queries = [
  'APP_INITIALIZATION_STATE',
  'pb=!1m',
  'window.location.href',
  'querySelectorAll',
  'innerText',
  'api/place/details',
  'google.com/maps/search',
  'fetch',
  'XMLHttpRequest'
];

searchFile(file1, queries);
searchFile(file2, queries);
