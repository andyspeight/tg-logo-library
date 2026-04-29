import sharp from 'sharp';

/**
 * Take an image buffer and produce a transparent PNG variant.
 * Logic: if corner pixels are near-uniform and near-white, treat as background
 * and remove. Otherwise return the original buffer (it may already be transparent
 * or have a background we can't safely remove without manual intervention).
 */
export async function makeTransparentPng(inputBuffer) {
  try {
    const img = sharp(inputBuffer);
    const meta = await img.metadata();

    // If it's already a PNG with alpha channel, check if it's already transparent
    if (meta.format === 'png' && meta.hasAlpha) {
      return {
        buffer: await img.png().toBuffer(),
        width: meta.width,
        height: meta.height,
        wasProcessed: false,
        notes: 'Already had alpha channel'
      };
    }

    // Get raw pixel data to inspect corners
    const { data, info } = await img
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const corners = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1]
    ];

    let r = 0, g = 0, b = 0;
    corners.forEach(([x, y]) => {
      const idx = (y * width + x) * channels;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
    });
    r = Math.round(r / 4);
    g = Math.round(g / 4);
    b = Math.round(b / 4);

    // Only treat as removable background if it's near-white
    // (don't try to remove dark/coloured backgrounds — too risky)
    const isWhitish = r > 230 && g > 230 && b > 230;

    if (!isWhitish) {
      return {
        buffer: await sharp(inputBuffer).png().toBuffer(),
        width: meta.width,
        height: meta.height,
        wasProcessed: false,
        notes: 'Background not white — kept original'
      };
    }

    // Walk every pixel and clear matching ones
    const tolerance = 30;
    for (let i = 0; i < data.length; i += channels) {
      const dr = Math.abs(data[i] - r);
      const dg = Math.abs(data[i + 1] - g);
      const db = Math.abs(data[i + 2] - b);
      if (dr < tolerance && dg < tolerance && db < tolerance) {
        data[i + 3] = 0;
      }
    }

    const buffer = await sharp(data, {
      raw: { width, height, channels }
    }).png().toBuffer();

    return {
      buffer,
      width,
      height,
      wasProcessed: true,
      notes: 'White background removed'
    };
  } catch (err) {
    console.error('[image-utils] makeTransparentPng failed:', err.message);
    throw err;
  }
}

/**
 * Convert any image buffer to a clean PNG (no processing, just format normalisation).
 */
export async function toPng(inputBuffer) {
  const img = sharp(inputBuffer);
  const meta = await img.metadata();
  return {
    buffer: await img.png().toBuffer(),
    width: meta.width || 0,
    height: meta.height || 0
  };
}

/**
 * Get metadata for an SVG buffer (sharp can't, so parse the XML).
 */
export function getSvgMetadata(svgBuffer) {
  const text = svgBuffer.toString('utf8');
  const w = text.match(/\swidth="([\d.]+)"/);
  const h = text.match(/\sheight="([\d.]+)"/);
  const vb = text.match(/viewBox="[\d.\s-]+\s([\d.]+)\s([\d.]+)"/);
  return {
    width: w ? Math.round(parseFloat(w[1])) : (vb ? Math.round(parseFloat(vb[1])) : 0),
    height: h ? Math.round(parseFloat(h[1])) : (vb ? Math.round(parseFloat(vb[2])) : 0)
  };
}

/** Generate a URL-safe slug from a brand name. */
export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
