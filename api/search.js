import Airtable from 'airtable';
import { TABLES, BRAND_FIELDS, ASSET_FIELDS } from './_lib/airtable.js';
import { rateLimit, denyRateLimit } from './_lib/auth.js';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rl = await rateLimit(req, 'search', 120, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { q, limit } = req.query;
  if (!q || typeof q !== 'string' || q.length < 1 || q.length > 100) {
    return res.status(400).json({ error: 'Invalid or missing q parameter' });
  }

  const max = Math.min(parseInt(limit, 10) || 12, 30);
  const query = q.trim().toLowerCase();

  try {
    const safeQuery = query.replace(/"/g, '\\"');
    const formula = `OR(SEARCH(LOWER("${safeQuery}"), LOWER({Brand Name} & "")), SEARCH(LOWER("${safeQuery}"), LOWER({Domain} & "")))`;

    const brandRecords = await base(TABLES.BRANDS).select({
      returnFieldsByFieldId: true,
      filterByFormula: formula,
      maxRecords: max,
      fields: [
        BRAND_FIELDS.NAME,
        BRAND_FIELDS.DOMAIN,
        BRAND_FIELDS.CATEGORY,
        BRAND_FIELDS.COLOUR_PRIMARY,
        BRAND_FIELDS.COLOUR_SECONDARY,
        BRAND_FIELDS.ASSETS
      ]
    }).firstPage();

    if (brandRecords.length === 0) {
      return res.json({ query, results: [] });
    }

    const allAssetIds = [];
    brandRecords.forEach(b => {
      const ids = b.get(BRAND_FIELDS.ASSETS) || [];
      ids.forEach(id => allAssetIds.push(id));
    });

    let assetsById = {};
    if (allAssetIds.length > 0) {
      const assetFormula = `OR(${allAssetIds.map(id => `RECORD_ID()="${id}"`).join(',')})`;
      const assetRecords = await base(TABLES.ASSETS).select({
        returnFieldsByFieldId: true,
        filterByFormula: assetFormula,
        fields: [
          ASSET_FIELDS.TYPE,
          ASSET_FIELDS.VARIANT,
          ASSET_FIELDS.FILE_URL,
          ASSET_FIELDS.WIDTH,
          ASSET_FIELDS.HEIGHT
        ]
      }).all();
      assetRecords.forEach(a => { assetsById[a.id] = a; });
    }

    const results = brandRecords.map(b => {
      const name = (b.get(BRAND_FIELDS.NAME) || '').toString();
      const domain = (b.get(BRAND_FIELDS.DOMAIN) || '').toString();
      const lname = name.toLowerCase();
      const ldomain = domain.toLowerCase();

      let score = 0;
      if (lname === query) score = 100;
      else if (lname.startsWith(query)) score = 80;
      else if (ldomain.startsWith(query)) score = 70;
      else if (lname.includes(query)) score = 50;
      else if (ldomain.includes(query)) score = 40;
      else score = 10;

      const linkedAssetIds = b.get(BRAND_FIELDS.ASSETS) || [];
      const assets = linkedAssetIds
        .map(id => assetsById[id])
        .filter(Boolean)
        .map(a => ({
          type: a.get(ASSET_FIELDS.TYPE),
          variant: a.get(ASSET_FIELDS.VARIANT),
          url: a.get(ASSET_FIELDS.FILE_URL),
          width: a.get(ASSET_FIELDS.WIDTH),
          height: a.get(ASSET_FIELDS.HEIGHT)
        }));

      const preferred =
        assets.find(a => a.type === 'SVG') ||
        assets.find(a => a.type === 'PNG-Transparent') ||
        assets[0] ||
        null;

      return {
        name,
        domain,
        category: b.get(BRAND_FIELDS.CATEGORY) || null,
        colourPrimary: b.get(BRAND_FIELDS.COLOUR_PRIMARY) || null,
        colourSecondary: b.get(BRAND_FIELDS.COLOUR_SECONDARY) || null,
        preferredUrl: preferred?.url || null,
        assets,
        _score: score
      };
    });

    results.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a.name.localeCompare(b.name);
    });

    results.forEach(r => delete r._score);

    return res.json({ query, results });
  } catch (err) {
    console.error('[search] Failed:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
}
