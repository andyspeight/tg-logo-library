const BRANDFETCH_API = 'https://api.brandfetch.io/v2';

/**
 * Fetch brand metadata + assets from Brandfetch.
 * Docs: https://docs.brandfetch.com/reference/brand-api
 *
 * Returns { name, domain, colours, logos: [{ type, theme, formats: [...] }] }
 * or null if not found.
 */
export async function fetchBrand(domain) {
  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) {
    console.warn('[brandfetch] No API key configured');
    return null;
  }

  try {
    const res = await fetch(`${BRANDFETCH_API}/brands/${encodeURIComponent(domain)}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      console.error('[brandfetch] API error', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return normaliseBrandfetch(data);
  } catch (err) {
    console.error('[brandfetch] Fetch failed:', err.message);
    return null;
  }
}

/** Convert Brandfetch's response into our common shape. */
function normaliseBrandfetch(data) {
  const colours = (data.colors || []).map(c => ({
    hex: c.hex,
    type: c.type
  }));

  const primary = colours.find(c => c.type === 'brand') || colours[0];
  const secondary = colours.find(c => c.type === 'accent') || colours[1];

  // Brandfetch returns logos as: [{ type: 'logo'|'icon'|'symbol', theme: 'light'|'dark'|null, formats: [...] }]
  const logos = (data.logos || []).map(logo => ({
    type: logo.type,                // logo, icon, symbol
    theme: logo.theme || 'default', // light, dark, default
    formats: (logo.formats || []).map(f => ({
      src: f.src,
      format: f.format,             // svg, png, jpeg
      width: f.width,
      height: f.height,
      size: f.size
    }))
  }));

  return {
    name: data.name,
    domain: data.domain,
    description: data.description || '',
    colourPrimary: primary?.hex || '',
    colourSecondary: secondary?.hex || '',
    logos
  };
}

/** Pick the best logo asset from Brandfetch results. */
export function pickBestLogo(brandfetchData) {
  if (!brandfetchData?.logos) return null;

  // Preference: logo type, light theme, SVG format
  for (const typePref of ['logo', 'symbol', 'icon']) {
    for (const themePref of ['light', 'default', 'dark']) {
      const match = brandfetchData.logos.find(l => l.type === typePref && l.theme === themePref);
      if (!match) continue;

      const svg = match.formats.find(f => f.format === 'svg');
      const png = match.formats.find(f => f.format === 'png');
      const best = svg || png || match.formats[0];
      if (best) {
        return {
          ...best,
          logoType: typePref,
          theme: themePref
        };
      }
    }
  }
  return null;
}
