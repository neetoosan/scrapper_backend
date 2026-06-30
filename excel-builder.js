// ─── Google Maps Workbook Builder (new flat format) ─────────────────────────
// Takes an array of flat business objects from gmaps-scraper.js
// Produces clean XLSX: one business per row, proper columns

function buildGoogleMapsWorkbook(businesses, pageTitle) {
  var rows = buildGoogleMapsRows(businesses);
  var sheetXml = buildSheetXml(rows, 1);
  var title = pageTitle || "Google Maps Scraped Data";
  var files = [
    {
      name: "[Content_Types].xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n</Types>')
    },
    {
      name: "_rels/.rels",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n</Relationships>')
    },
    {
      name: "docProps/app.xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Edge Maps Scraper</Application></Properties>')
    },
    {
      name: "docProps/core.xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + escapeXml(title) + '</dc:title><dc:creator>Edge Maps Scraper</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created></cp:coreProperties>')
    },
    {
      name: "xl/workbook.xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Businesses" sheetId="1" r:id="rId1"/></sheets></workbook>')
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    },
    {
      name: "xl/styles.xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>')
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xmlBytes(sheetXml)
    }
  ];
  return createZip(files);
}

function buildGoogleMapsRows(businesses) {
  var header = [
    "Name", "Category", "Rating", "Reviews", "Phone",
    "Website", "Email", "Address", "Hours", "Socials"
  ];
  var rows = [header];

  for (var i = 0; i < businesses.length; i++) {
    var b = businesses[i];
    var cleanName = (b.name || "").replace(/"/g, '""');
    var nameCell = b.placeUrl ? `=HYPERLINK("${b.placeUrl}", "${cleanName}")` : (b.name || "");
    
    var socialsList = [b.facebook, b.instagram, b.twitter, b.linkedin].filter(Boolean);
    var socialsStr = socialsList.join(", ");

    rows.push([
      nameCell,
      b.category || "",
      b.rating || "",
      b.reviewCount || "",
      b.phone || "",
      b.website || "",
      b.email || "",
      b.address || "",
      b.hours || "",
      socialsStr
    ]);
  }
  return rows;
}

// ─── Legacy Workbook Builder (for generic website scraping) ─────────────────
function buildWorkbook(result) {
  const rows = buildRows(result);
  
  // Determine freeze row index
  let freezeRow = 0;
  if (Array.isArray(result.crawlPages) && result.crawlPages.length > 0) {
    freezeRow = 5;
  } else if (Array.isArray(result.listings) && result.listings.length > 0) {
    freezeRow = 4;
  } else {
    freezeRow = 4;
  }

  const sheetXml = buildSheetXml(rows, freezeRow);
  const files = [
    {
      name: "[Content_Types].xml",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`)
    },
    {
      name: "_rels/.rels",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`)
    },
    {
      name: "docProps/app.xml",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Edge Contact Scraper</Application>
</Properties>`)
    },
    {
      name: "docProps/core.xml",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(result.page.title || "Scraped Contacts")}</dc:title>
  <dc:creator>Edge Contact Scraper</dc:creator>
  <cp:lastModifiedBy>Edge Contact Scraper</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`)
    },
    {
      name: "xl/workbook.xml",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Contacts" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`)
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)
    },
    {
      name: "xl/styles.xml",
      data: xmlBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>')
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xmlBytes(sheetXml)
    }
  ];

  return createZip(files);
}

function buildRows(result) {
  if (Array.isArray(result.crawlPages) && result.crawlPages.length > 0) {
    return buildCrawlRows(result);
  }

  if (Array.isArray(result.listings) && result.listings.length > 0) {
    return buildListingRows(result);
  }

  const maxLength = Math.max(
    result.names.length,
    result.companyNames.length,
    result.phoneNumbers.length,
    result.whatsappNumbers.length,
    result.socialMediaHandles.length,
    result.emails.length,
    result.websites?.length || 0,
    result.addresses?.length || 0,
    1
  );

  const rows = [
    ["Page title", result.page.title || ""],
    ["Page URL", result.page.url || ""],
    [],
    ["Name", "Company", "Phone", "WhatsApp", "Socials", "Email", "Website", "Address"]
  ];

  for (let index = 0; index < maxLength; index += 1) {
    rows.push([
      result.names[index] || "",
      result.companyNames[index] || "",
      result.phoneNumbers[index] || "",
      result.whatsappNumbers[index] || "",
      result.socialMediaHandles[index] || "",
      result.emails[index] || "",
      (result.websites && result.websites[index]) || "",
      (result.addresses && result.addresses[index]) || ""
    ]);
  }

  return rows;
}

function buildCrawlRows(result) {
  const rows = [
    ["Page title", result.page.title || ""],
    ["Page URL", result.page.url || ""],
    ["Pages scanned", String(result.pagesScanned || result.crawlPages.length || 0)],
    [],
    ["Source Page", "Names", "Companies", "Phones", "WhatsApp", "Socials", "Emails", "Website", "Address", "Category", "Rating", "Review count"]
  ];

  for (const item of result.crawlPages) {
    const firstListing = Array.isArray(item.listings) && item.listings.length > 0 ? item.listings[0] : {};
    
    const cleanTitle = (item.pageTitle || "Page Link").replace(/"/g, '""');
    const sourceCell = item.sourceUrl ? `=HYPERLINK("${item.sourceUrl}", "${cleanTitle}")` : (item.pageTitle || "");

    rows.push([
      sourceCell,
      (item.names || []).join(", "),
      (item.companyNames || []).join(", "),
      (item.phoneNumbers || []).join(", "),
      (item.whatsappNumbers || []).join(", "),
      (item.socialMediaHandles || []).join(", "),
      (item.emails || []).join(", "),
      firstListing.website || (item.websites || []).join(", ") || "",
      firstListing.address || (item.addresses || []).join(" | ") || "",
      firstListing.category || "",
      firstListing.rating || "",
      firstListing.reviewCount || ""
    ]);
  }

  return rows;
}

function buildListingRows(result) {
  const rows = [
    ["Page title", result.page.title || ""],
    ["Page URL", result.page.url || ""],
    [],
    ["Name", "Company", "Phone", "WhatsApp", "Socials", "Email", "Website", "Address", "Category", "Rating", "Review count", "Source Page"]
  ];

  for (const listing of result.listings) {
    const cleanName = (listing.name || "Listing").replace(/"/g, '""');
    const nameCell = listing.sourceUrl ? `=HYPERLINK("${listing.sourceUrl}", "${cleanName}")` : (listing.name || "");

    rows.push([
      nameCell,
      listing.companyName || "",
      (listing.phoneNumbers || []).join(", "),
      (listing.whatsappNumbers || []).join(", "),
      (listing.socialMediaHandles || []).join(", "),
      (listing.emails || []).join(", "),
      listing.website || "",
      listing.address || "",
      listing.category || "",
      listing.rating || "",
      listing.reviewCount || "",
      listing.pageTitle || ""
    ]);
  }

  return rows;
}

function buildSheetXml(rows, freezeRowNumber) {
  const rowXml = rows
    .map((cells, rowIndex) => {
      const cellXml = cells
        .map((value, cellIndex) => buildCellXml(rowIndex + 1, cellIndex, value, freezeRowNumber))
        .join("");
      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join("");

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const endCol = columnName(columnCount - 1);

  let paneXml = "";
  if (freezeRowNumber) {
    paneXml = `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="${freezeRowNumber}" topLeftCell="A${freezeRowNumber + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  } else {
    paneXml = `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${endCol}${rows.length}"/>
  ${paneXml}
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    ${buildColumnXml(columnCount)}
  </cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A${freezeRowNumber || 1}:${endCol}${rows.length}"/>
</worksheet>`;
}

function buildColumnXml(columnCount) {
  const widths = [28, 44, 28, 28, 24, 24, 32, 36, 24, 14, 16, 32, 28];
  const columns = [];

  for (let index = 0; index < columnCount; index += 1) {
    const width = widths[index] || 24;
    columns.push(`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`);
  }

  return columns.join("");
}

function buildCellXml(rowNumber, cellIndex, value, freezeRowNumber) {
  const reference = `${columnName(cellIndex)}${rowNumber}`;
  let style = "";
  if (freezeRowNumber) {
    if (rowNumber <= freezeRowNumber) {
      style = ' s="1"';
    }
  } else if (rowNumber === 1) {
    style = ' s="1"';
  }
  
  const valStr = value == null ? "" : String(value);
  if (valStr.startsWith("=")) {
    // Extract the label/friendly name from the HYPERLINK formula to use as the cached value
    // e.g. =HYPERLINK("url", "friendly name")
    let cachedVal = "";
    const match = valStr.match(/,\s*"([^"]*)"\s*\)$/);
    if (match) {
      cachedVal = match[1];
    }
    const formulaXml = escapeXmlText(valStr.slice(1));
    const valXml = cachedVal ? `<v>${escapeXml(cachedVal)}</v>` : "";
    return `<c r="${reference}" t="str"${style}><f>${formulaXml}</f>${valXml}</c>`;
  } else {
    return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(valStr)}</t></is></c>`;
  }
}

function columnName(index) {
  let value = index + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function escapeXml(value) {
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeXmlText(value) {
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlBytes(xml) {
  return new TextEncoder().encode(xml);
}

function createZip(files) {
  const crcTable = getCrc32Table();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const dataBytes = file.data;
    const crc32 = computeCrc32(dataBytes, crcTable);
    const localHeader = concatBytes(
      uint32LE(0x04034b50),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(crc32),
      uint32LE(dataBytes.length),
      uint32LE(dataBytes.length),
      uint16LE(nameBytes.length),
      uint16LE(0),
      nameBytes
    );

    localParts.push(localHeader, dataBytes);

    const centralHeader = concatBytes(
      uint32LE(0x02014b50),
      uint16LE(20),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(crc32),
      uint32LE(dataBytes.length),
      uint32LE(dataBytes.length),
      uint16LE(nameBytes.length),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(0),
      uint32LE(offset),
      nameBytes
    );

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  const endOfCentralDirectory = concatBytes(
    uint32LE(0x06054b50),
    uint16LE(0),
    uint16LE(0),
    uint16LE(files.length),
    uint16LE(files.length),
    uint32LE(centralDirectory.length),
    uint32LE(offset),
    uint16LE(0)
  );

  return concatBytes(...localParts, centralDirectory, endOfCentralDirectory);
}

function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;

  for (const array of arrays) {
    output.set(array, cursor);
    cursor += array.length;
  }

  return output;
}

function uint16LE(value) {
  return Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
}

function uint32LE(value) {
  return Uint8Array.of(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff
  );
}

function getCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[index] = current >>> 0;
  }

  return table;
}

function computeCrc32(bytes, table) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

