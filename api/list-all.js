import Airtable from 'airtable';
import { TABLES, BRAND_FIELDS, ASSET_FIELDS } from './_lib/airtable.js';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  const rl = await rateLimit(req, 'list-all', 60, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const { sort, filter, offset } = req.query;

  // Sort config — uses field IDs since we're returning fields by ID
  const validSorts = {
    'date-desc': [{ field: BRAND_FIELDS.DATE_ADDED, direction: 'desc' }],
    'date-asc': [{ field: BRAND_FIELDS.DATE_ADDED, direction: 'asc' }],
    'name-asc': [{ field: BRAND_FIELDS.NAME, direction: 'asc' }],
    'name-desc': [{ field: BRAND_FIELDS.NAME, direction: 'desc' }],
    'category-asc': [{ field: BRAND_FIELDS.CATEGORY, direction: 'asc' }, { field: BRAND_FIELDS.NAME, direction: 'asc' }]
  };
  const sortConfig = validSorts[sort] || validSorts['date-desc'];

  let filterByFormula;
  if (filter === 'tg-suppliers') {
    filterByFormula = `{Travelgenix Supplier} = 1`;
  } else if (filter === 'no-assets') {
    filterByFormula = `OR({Assets} = BLANK(), {Assets} = "")`;
  }

  try {
    const selectOpts = {
      returnFieldsByFieldId: true,
      sort: sortConfig,
      pageSize: 50,
      fields: [
        BRAND_FIELDS.NAME,
        BRAND_FIELDS.DOMAIN,
        BRAND_FIELDS.CATEGORY,
        BRAND_FIELDS.STATUS,
        BRAND_FIELDS.COLOUR_PRIMARY,
        BRAND_FIELDS.COLOUR_SECONDARY,
        BRAND_FIELDS.TG_SUPPLIER,
        BRAND_FIELDS.DATE_ADDED,
        BRAND_FIELDS.LAST_VERIFIED,
        BRAND_FIELDS.ASSETS
      ]
    };
    if (filterByFormula) selectOpts.filterByFormula = filterByFormula;

    const query = base(TABLES.BRANDS).select(selectOpts);
    let records;
    let nextOffset = null;

    if (offset) {
      const allRecords = [];
      await query.eachPage((pageRecords, fetchNextPage) => {
        pageRecords.forEach(r => allRecords.push(r));
        if (allRecords.length >= 1000) return;
        fetchNextPage();
      });
      const start = parseInt(offset, 10) || 0;
      records = allRecords.slice(start, start + 50);
      if (allRecords.length > start + 50) nextOffset = (start + 50).toString();
    } else {
      records = await query.firstPage();
      if (records.length === 50) nextOffset = '50';
    }

    // Collect first asset ID per brand for previews
    const allAssetIds = [];
    records.forEach(r => {
      const ids = r.get(BRAND_FIELDS.ASSETS) || [];
      if (ids[0]) allAssetIds.push(ids[0]);
    });

    let previewById = {};
    if (allAssetIds.length > 0) {
      const assetFormula = `OR(${allAssetIds.map(id => `RECORD_ID()="${id}"`).join(',')})`;
      const assetRecords = await base(TABLES.ASSETS).select({
        returnFieldsByFieldId: true,
        filterByFormula: assetFormula,
        fields: [ASSET_FIELDS.TYPE, ASSET_FIELDS.FILE_URL]
      }).all();
      assetRecords.forEach(a => {
        previewById[a.id] = {
          type: a.get(ASSET_FIELDS.TYPE),
          url: a.get(ASSET_FIELDS.FILE_URL)
        };
      });
    }

    const results = records.map(r => {
      const assetIds = r.get(BRAND_FIELDS.ASSETS) || [];
      const firstAssetId = assetIds[0];
      const preview = firstAssetId ? previewById[firstAssetId] : null;

      return {
        recordId: r.id,
        name: r.get(BRAND_FIELDS.NAME) || '',
        domain: r.get(BRAND_FIELDS.DOMAIN) || '',
        category: r.get(BRAND_FIELDS.CATEGORY) || null,
        status: r.get(BRAND_FIELDS.STATUS) || null,
        colourPrimary: r.get(BRAND_FIELDS.COLOUR_PRIMARY) || null,
        colourSecondary: r.get(BRAND_FIELDS.COLOUR_SECONDARY) || null,
        tgSupplier: !!r.get(BRAND_FIELDS.TG_SUPPLIER),
        dateAdded: r.get(BRAND_FIELDS.DATE_ADDED) || null,
        lastVerified: r.get(BRAND_FIELDS.LAST_VERIFIED) || null,
        assetCount: assetIds.length,
        previewUrl: preview?.url || null
      };
    });

    return res.json({
      results,
      count: results.length,
      nextOffset
    });
  } catch (err) {
    console.error('[list-all] Failed:', err);
    return res.status(500).json({ error: 'List failed' });
  }
}
