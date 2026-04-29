import { fetchBrand, pickBestLogo } from './_lib/brandfetch.js';
import { fetchClearbit, fetchLogoDev, fetchGoogleFavicon, fetchBrandfetchCdn } from './_lib/sources.js';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  const rl = await rateLimit(req, 'discover', 20, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const { domain } = req.body || {};
  if (!domain || typeof domain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({ error: 'Invalid domain' });
  }

  try {
    // Run all sources in parallel
    const [brandfetchData, cbResult, ldResult, gfResult, bfCdnResult] = await Promise.all([
      fetchBrand(domain),
      fetchClearbit(domain),
      fetchLogoDev(domain),
      fetchGoogleFavicon(domain),
      fetchBrandfetchCdn(domain)
    ]);

    const candidates = [];

    // Brandfetch full API result — has SVG and multiple variants
    if (brandfetchData) {
      const bestLogo = pickBestLogo(brandfetchData);
      if (bestLogo) {
        candidates.push({
          source: 'Brandfetch (API)',
          url: bestLogo.src,
          format: bestLogo.format,
          width: bestLogo.width,
          height: bestLogo.height,
          quality: 'High',
          isSvg: bestLogo.format === 'svg',
          theme: bestLogo.theme,
          logoType: bestLogo.logoType
        });
      }

      // Also expose all variants for advanced selection
      brandfetchData.logos.forEach(logo => {
        logo.formats.forEach(f => {
          // Skip the "best" we already added
          if (f.src === bestLogo?.src) return;
          candidates.push({
            source: `Brandfetch (${logo.type}/${logo.theme})`,
            url: f.src,
            format: f.format,
            width: f.width,
            height: f.height,
            quality: 'High',
            isSvg: f.format === 'svg',
            theme: logo.theme,
            logoType: logo.type
          });
        });
      });
    }

    // Direct fetches (we have the actual buffers — but don't ship them in the response)
    [bfCdnResult, cbResult, ldResult, gfResult].forEach(r => {
      if (!r) return;
      candidates.push({
        source: r.source,
        url: r.url,
        format: r.isSvg ? 'svg' : r.contentType.split('/')[1],
        width: r.width,
        height: r.height,
        quality: r.source === 'Google Favicon' ? 'Low (fallback)' : 'Medium',
        isSvg: r.isSvg
      });
    });

    return res.json({
      domain,
      brandfetch: brandfetchData ? {
        name: brandfetchData.name,
        description: brandfetchData.description,
        colourPrimary: brandfetchData.colourPrimary,
        colourSecondary: brandfetchData.colourSecondary
      } : null,
      candidates,
      sourcesTried: ['Brandfetch', 'Clearbit', 'Logo.dev', 'Google Favicon'],
      sourcesSucceeded: candidates.map(c => c.source.split(' ')[0]).filter((v, i, a) => a.indexOf(v) === i)
    });
  } catch (err) {
    console.error('[discover] Failed:', err);
    return res.status(500).json({ error: 'Discovery failed' });
  }
}
