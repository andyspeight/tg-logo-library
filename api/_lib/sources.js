import sharp from 'sharp';

/**
 * Fetch image from a URL and return its metadata + buffer.
 * Returns null on any failure (404, timeout, invalid image).
 */
async function fetchImage(url, sourceName) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());

    // Validate it's actually an image we can process
    let width = 0, height = 0;
    if (contentType.includes('svg')) {
      // Parse SVG dimensions from the XML
      const text = buffer.toString('utf8');
      const w = text.match(/width="(\d+(?:\.\d+)?)"/);
      const h = text.match(/height="(\d+(?:\.\d+)?)"/);
      const vb = text.match(/viewBox="[\d.\s-]+\s([\d.]+)\s([\d.]+)"/);
      width = w ? Math.round(parseFloat(w[1])) : (vb ? Math.round(parseFloat(vb[1])) : 0);
      height = h ? Math.round(parseFloat(h[1])) : (vb ? Math.round(parseFloat(vb[2])) : 0);
    } else {
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width || 0;
        height = meta.height || 0;
      } catch (err) {
        return null;
      }
    }

    return {
      url,
      source: sourceName,
      contentType,
      buffer,
      width,
      height,
      sizeKb: Math.round(buffer.length / 1024),
      isSvg: contentType.includes('svg')
    };
  } catch (err) {
    console.warn(`[${sourceName}] Failed:`, err.message);
    return null;
  }
}

export async function fetchClearbit(domain) {
  return fetchImage(`https://logo.clearbit.com/${domain}?size=512`, 'Clearbit');
}

export async function fetchLogoDev(domain) {
  const key = process.env.LOGODEV_API_KEY;
  if (!key) return null;
  return fetchImage(`https://img.logo.dev/${domain}?token=${key}&size=512&format=png`, 'Logo.dev');
}

export async function fetchGoogleFavicon(domain) {
  return fetchImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=256`, 'Google Favicon');
}

export async function fetchBrandfetchCdn(domain) {
  return fetchImage(`https://cdn.brandfetch.io/${domain}`, 'Brandfetch CDN');
}
