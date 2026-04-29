import { listAssetsByDomain, BRAND_FIELDS, ASSET_FIELDS } from './_lib/airtable.js';
import { rateLimit, denyRateLimit } from './_lib/auth.js';

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rl = await rateLimit(req, 'list', 60, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { domain } = req.query;
  if (!domain || typeof domain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  try {
    const result = await listAssetsByDomain(domain.toLowerCase());
    if (!result) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const { brand, assets } = result;
    return res.json({
      brand: {
        name: brand.get(BRAND_FIELDS.NAME),
        domain: brand.get(BRAND_FIELDS.DOMAIN),
        category: brand.get(BRAND_FIELDS.CATEGORY),
        colourPrimary: brand.get(BRAND_FIELDS.COLOUR_PRIMARY),
        colourSecondary: brand.get(BRAND_FIELDS.COLOUR_SECONDARY)
      },
      assets: assets.map(a => ({
        type: a.get(ASSET_FIELDS.TYPE),
        variant: a.get(ASSET_FIELDS.VARIANT),
        url: a.get(ASSET_FIELDS.FILE_URL),
        width: a.get(ASSET_FIELDS.WIDTH),
        height: a.get(ASSET_FIELDS.HEIGHT)
      }))
    });
  } catch (err) {
    console.error('[list] Failed:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}
