import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ============ TABLE + FIELD IDS ============
// Hardcoded so renaming in the Airtable UI never breaks code.

export const TABLES = {
  BRANDS: 'tblcy7DwlCfCdUNVd',
  ASSETS: 'tblMmJWiimFI9xwln',
  DISCOVERY_LOG: 'tblX9OX83mXK1arps'
};

export const BRAND_FIELDS = {
  NAME: 'fldgTqgBYwPgPvB0y',
  DOMAIN: 'fldaZEZGbE6JAeKtb',
  STATUS: 'fldvrlflh2r2ANv4I',
  CATEGORY: 'flduBeR8Qxsfwmzw1',
  COLOUR_PRIMARY: 'fldY1oEncc1MYblLc',
  COLOUR_SECONDARY: 'fldrIFGkZ7p5ZGkGr',
  NOTES: 'fldlXVcsf85byxW1B',
  TG_SUPPLIER: 'fldWZeye5PRLabs1h',
  DATE_ADDED: 'fld3VbPMkL4NBgGoP',
  LAST_VERIFIED: 'fldiEmnd6Uskt9HMJ',
  ASSETS: 'fldoyWUOPbAckBRzk'
};

export const ASSET_FIELDS = {
  ASSET_ID: 'fldRgMIrg0eQQAxeL',
  BRAND: 'fldxEKaKS2gVv6xRa',
  TYPE: 'fldY239IMrdanKO36',
  VARIANT: 'fldGWSp81Djl5EADB',
  SOURCE: 'fld1rNeWl2fTnTLhw',
  FILE_URL: 'fldkUJCcajRQ7iK9s',
  WIDTH: 'fld9xjnF1JQYXtcBt',
  HEIGHT: 'flduuowNXiEHqxfca',
  FILE_SIZE_KB: 'fldwCiIpJMfHH7dO3',
  ORIGINAL_URL: 'fldPPUAdAoUmoyUU4',
  DATE_ADDED: 'fldvA1tvGzm9FJFic'
};

export const LOG_FIELDS = {
  SEARCH_ID: 'fldrStJlbP3gKKG3J',
  BRAND_SEARCHED: 'fldBl0qKIdH9AYWTf',
  RESOLVED_DOMAIN: 'fldjwVmD8gR3Q0IiG',
  SOURCES_TRIED: 'fldll86Cn53dygYjr',
  SOURCES_SUCCEEDED: 'fldnCpApCVwfKJXnf',
  SELECTED_SOURCE: 'fldEk6mEXsVlpTkEm',
  TIMESTAMP: 'fld1JSf1vkVM3RD4J',
  NOTES: 'fldgzeeORLmJghyuO'
};

// ============ HELPERS ============

/**
 * Find an existing brand record by domain (case-insensitive).
 * Uses string concatenation trick (& "") to coerce URL field to text,
 * which makes LOWER() work reliably. Strips https:// and trailing slashes
 * for robust comparison since URL fields can store various formats.
 */
export async function findBrandByDomain(domain) {
  const normalised = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/"/g, '');

  // SUBSTITUTE() strips https:// and trailing slash from the stored value
  // so we compare clean domain to clean domain
  const formula = `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Domain} & "", "https://", ""), "http://", ""), "/", "")) = "${normalised}"`;

  const records = await base(TABLES.BRANDS).select({
    filterByFormula: formula,
    maxRecords: 1
  }).firstPage();
  return records[0] || null;
}

/** Create a new brand record. Returns the record. */
export async function createBrand(fields) {
  const records = await base(TABLES.BRANDS).create([{
    fields: {
      [BRAND_FIELDS.NAME]: fields.name,
      [BRAND_FIELDS.DOMAIN]: fields.domain,
      [BRAND_FIELDS.STATUS]: fields.status || 'Active',
      [BRAND_FIELDS.CATEGORY]: fields.category || 'Other',
      [BRAND_FIELDS.COLOUR_PRIMARY]: fields.colourPrimary || '',
      [BRAND_FIELDS.COLOUR_SECONDARY]: fields.colourSecondary || '',
      [BRAND_FIELDS.NOTES]: fields.notes || '',
      [BRAND_FIELDS.TG_SUPPLIER]: fields.tgSupplier || false,
      [BRAND_FIELDS.DATE_ADDED]: new Date().toISOString(),
      [BRAND_FIELDS.LAST_VERIFIED]: new Date().toISOString()
    }
  }], { typecast: true });
  return records[0];
}

/** Update an existing brand. */
export async function updateBrand(recordId, fields) {
  const mapped = {};
  if (fields.name !== undefined) mapped[BRAND_FIELDS.NAME] = fields.name;
  if (fields.domain !== undefined) mapped[BRAND_FIELDS.DOMAIN] = fields.domain;
  if (fields.status !== undefined) mapped[BRAND_FIELDS.STATUS] = fields.status;
  if (fields.category !== undefined) mapped[BRAND_FIELDS.CATEGORY] = fields.category;
  if (fields.colourPrimary !== undefined) mapped[BRAND_FIELDS.COLOUR_PRIMARY] = fields.colourPrimary;
  if (fields.colourSecondary !== undefined) mapped[BRAND_FIELDS.COLOUR_SECONDARY] = fields.colourSecondary;
  if (fields.notes !== undefined) mapped[BRAND_FIELDS.NOTES] = fields.notes;
  if (fields.tgSupplier !== undefined) mapped[BRAND_FIELDS.TG_SUPPLIER] = fields.tgSupplier;
  mapped[BRAND_FIELDS.LAST_VERIFIED] = new Date().toISOString();

  const records = await base(TABLES.BRANDS).update([{
    id: recordId,
    fields: mapped
  }], { typecast: true });
  return records[0];
}

/** Create an asset record linked to a brand. */
export async function createAsset(fields) {
  const records = await base(TABLES.ASSETS).create([{
    fields: {
      [ASSET_FIELDS.ASSET_ID]: fields.assetId,
      [ASSET_FIELDS.BRAND]: [fields.brandRecordId],
      [ASSET_FIELDS.TYPE]: fields.type,
      [ASSET_FIELDS.VARIANT]: fields.variant || 'Default',
      [ASSET_FIELDS.SOURCE]: fields.source,
      [ASSET_FIELDS.FILE_URL]: fields.fileUrl,
      [ASSET_FIELDS.WIDTH]: fields.width || 0,
      [ASSET_FIELDS.HEIGHT]: fields.height || 0,
      [ASSET_FIELDS.FILE_SIZE_KB]: fields.fileSizeKb || 0,
      [ASSET_FIELDS.ORIGINAL_URL]: fields.originalUrl || '',
      [ASSET_FIELDS.DATE_ADDED]: new Date().toISOString()
    }
  }], { typecast: true });
  return records[0];
}

/** Append to the discovery log. */
export async function logDiscovery(fields) {
  const searchId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await base(TABLES.DISCOVERY_LOG).create([{
    fields: {
      [LOG_FIELDS.SEARCH_ID]: searchId,
      [LOG_FIELDS.BRAND_SEARCHED]: fields.brandSearched,
      [LOG_FIELDS.RESOLVED_DOMAIN]: fields.resolvedDomain || '',
      [LOG_FIELDS.SOURCES_TRIED]: fields.sourcesTried || [],
      [LOG_FIELDS.SOURCES_SUCCEEDED]: fields.sourcesSucceeded || [],
      [LOG_FIELDS.SELECTED_SOURCE]: fields.selectedSource || '',
      [LOG_FIELDS.TIMESTAMP]: new Date().toISOString(),
      [LOG_FIELDS.NOTES]: fields.notes || ''
    }
  }], { typecast: true });
}

/** List all assets for a brand by domain. Used by the public list API. */
export async function listAssetsByDomain(domain) {
  const brand = await findBrandByDomain(domain);
  if (!brand) return null;

  const assetIds = brand.get(BRAND_FIELDS.ASSETS) || [];
  if (assetIds.length === 0) return { brand, assets: [] };

  const assets = await base(TABLES.ASSETS).select({
    filterByFormula: `OR(${assetIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`
  }).all();

  return { brand, assets };
}
