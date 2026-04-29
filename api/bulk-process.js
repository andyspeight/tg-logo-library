import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { fetchBrand, pickBestLogo } from './_lib/brandfetch.js';
import { fetchClearbit, fetchLogoDev, fetchGoogleFavicon, fetchBrandfetchCdn } from './_lib/sources.js';
import { uploadAsset } from './_lib/blob.js';
import { makeTransparentPng, slugify, getSvgMetadata } from './_lib/image-utils.js';
import { findBrandByDomain, createBrand, updateBrand, createAsset, logDiscovery } from './_lib/airtable.js';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

// Hardcoded for now — same map as resolve-domain.js
const KNOWN_DOMAINS = {
  'virgin atlantic': 'virginatlantic.com',
  'jet2': 'jet2.com',
  'jet2 holidays': 'jet2holidays.com',
  'tui': 'tui.co.uk',
  'hotelbeds': 'hotelbeds.com',
  'ratehawk': 'ratehawk.com',
  'webbeds': 'webbeds.com',
  'etihad': 'etihad.com',
  'etihad holidays': 'etihadholidays.com',
  'gold medal': 'goldmedal.co.uk',
  'aerticket': 'aerticket.de',
  'faremine': 'faremine.com',
  'holiday taxis': 'holidaytaxis.com',
  'flexible autos': 'flexibleautos.com',
  'travelgenix': 'travelgenix.io',
  'british airways': 'britishairways.com',
  'easyjet': 'easyjet.com',
  'ryanair': 'ryanair.com',
  'emirates': 'emirates.com',
  'qatar airways': 'qatarairways.com',
  'singapore airlines': 'singaporeair.com',
  'lufthansa': 'lufthansa.com',
  'air france': 'airfrance.com',
  'klm': 'klm.com'
};

async function resolveDomain(brandName, anthropicClient) {
  const lower = brandName.toLowerCase().trim();
  if (KNOWN_DOMAINS[lower]) {
    return { domain: KNOWN_DOMAINS[lower], method: 'known' };
  }
  if (anthropicClient) {
    try {
      const message = await anthropicClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `What is the official primary domain for the company "${brandName}"?\n\nRespond with ONLY the domain (no protocol, no path), like "example.com". If you don't know, respond with exactly "UNKNOWN".`
        }]
      });
      const text = message.content[0]?.text?.trim().toLowerCase();
      if (text && text !== 'unknown' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(text)) {
        return { domain: text, method: 'ai' };
      }
    } catch (err) {
      console.error('[bulk-process] AI resolve failed:', err.message);
    }
  }
  // Naive fallback
  const naive = lower.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + '.com';
  return { domain: naive, method: 'naive' };
}

// Discover the best candidate logo, prioritising Brandfetch API > Brandfetch CDN > Clearbit > Logo.dev
async function discoverBestCandidate(domain) {
  const [brandfetchData, bfCdn, cb, ld] = await Promise.all([
    fetchBrand(domain),
    fetchBrandfetchCdn(domain),
    fetchClearbit(domain),
    fetchLogoDev(domain)
  ]);

  let brandfetchMeta = null;
  if (brandfetchData) {
    brandfetchMeta = {
      colourPrimary: brandfetchData.colourPrimary,
      colourSecondary: brandfetchData.colourSecondary
    };
    const best = pickBestLogo(brandfetchData);
    if (best) {
      return {
        candidate: {
          source: 'Brandfetch (API)',
          url: best.src,
          format: best.format,
          isSvg: best.format === 'svg'
        },
        brandfetchMeta,
        sourcesTried: ['Brandfetch', 'Clearbit', 'Logo.dev']
      };
    }
  }

  // Fall through to direct image sources
  const fallbacks = [bfCdn, cb, ld].filter(Boolean);
  if (fallbacks.length > 0) {
    const r = fallbacks[0];
    return {
      candidate: {
        source: r.source,
        url: r.url,
        format: r.isSvg ? 'svg' : 'png',
        isSvg: r.isSvg
      },
      brandfetchMeta,
      sourcesTried: ['Brandfetch', 'Clearbit', 'Logo.dev']
    };
  }

  return { candidate: null, brandfetchMeta, sourcesTried: ['Brandfetch', 'Clearbit', 'Logo.dev'] };
}

// Save a candidate to Airtable + Blob. Returns the saved record info.
async function saveCandidate({ brandName, domain, candidate, brandfetchMeta, sourcesTried }) {
  const slug = slugify(brandName);

  // Fetch the chosen image
  const imgRes = await fetch(candidate.url);
  if (!imgRes.ok) throw new Error('Could not fetch source image');
  const contentType = imgRes.headers.get('content-type') || '';
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const isSvg = contentType.includes('svg') || candidate.url.toLowerCase().endsWith('.svg');

  // Find or create brand
  let brandRecord = await findBrandByDomain(domain);
  if (!brandRecord) {
    brandRecord = await createBrand({
      name: brandName,
      domain,
      category: 'Other',
      colourPrimary: brandfetchMeta?.colourPrimary || '',
      colourSecondary: brandfetchMeta?.colourSecondary || '',
      tgSupplier: false
    });
  } else {
    brandRecord = await updateBrand(brandRecord.id, {
      colourPrimary: brandfetchMeta?.colourPrimary || undefined,
      colourSecondary: brandfetchMeta?.colourSecondary || undefined
    });
  }

  const savedAssets = [];

  // Save original
  if (isSvg) {
    const meta = getSvgMetadata(buffer);
    const upload = await uploadAsset({
      slug, type: 'svg', variant: 'default', ext: 'svg',
      buffer, contentType: 'image/svg+xml'
    });
    await createAsset({
      assetId: `${slug}-svg-default`,
      brandRecordId: brandRecord.id,
      type: 'SVG',
      variant: 'Default',
      source: candidate.source,
      fileUrl: upload.url,
      width: meta.width, height: meta.height,
      fileSizeKb: upload.sizeKb,
      originalUrl: candidate.url
    });
    savedAssets.push({ type: 'SVG', url: upload.url });
  } else {
    const png = await sharp(buffer).png().toBuffer();
    const meta = await sharp(png).metadata();
    const upload = await uploadAsset({
      slug, type: 'png-original', variant: 'default', ext: 'png',
      buffer: png, contentType: 'image/png'
    });
    await createAsset({
      assetId: `${slug}-png-original-default`,
      brandRecordId: brandRecord.id,
      type: 'PNG-Original',
      variant: 'Default',
      source: candidate.source,
      fileUrl: upload.url,
      width: meta.width || 0, height: meta.height || 0,
      fileSizeKb: upload.sizeKb,
      originalUrl: candidate.url
    });
    savedAssets.push({ type: 'PNG-Original', url: upload.url });
  }

  // Generate transparent PNG variant
  let transparentBuffer, transparentMeta;
  if (isSvg) {
    const png = await sharp(buffer).resize({ width: 1024, withoutEnlargement: true }).png().toBuffer();
    const result = await makeTransparentPng(png);
    transparentBuffer = result.buffer;
    transparentMeta = { width: result.width, height: result.height };
  } else {
    const result = await makeTransparentPng(buffer);
    transparentBuffer = result.buffer;
    transparentMeta = { width: result.width, height: result.height };
  }

  const transUpload = await uploadAsset({
    slug, type: 'png-transparent', variant: 'default', ext: 'png',
    buffer: transparentBuffer, contentType: 'image/png'
  });
  await createAsset({
    assetId: `${slug}-png-transparent-default`,
    brandRecordId: brandRecord.id,
    type: 'PNG-Transparent',
    variant: 'Default',
    source: 'Generated',
    fileUrl: transUpload.url,
    width: transparentMeta.width, height: transparentMeta.height,
    fileSizeKb: transUpload.sizeKb,
    originalUrl: candidate.url
  });
  savedAssets.push({ type: 'PNG-Transparent', url: transUpload.url });

  // Log it
  await logDiscovery({
    brandSearched: brandName,
    resolvedDomain: domain,
    sourcesTried,
    sourcesSucceeded: [candidate.source.split(' ')[0]],
    selectedSource: candidate.source,
    notes: `Bulk import — ${savedAssets.length} assets saved`
  });

  return savedAssets;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  const rl = await rateLimit(req, 'bulk-process', 4, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const { brands } = req.body || {};
  if (!Array.isArray(brands) || brands.length === 0 || brands.length > 100) {
    return res.status(400).json({ error: 'brands must be an array of 1–100 names' });
  }

  // Validate each entry
  const cleanBrands = brands
    .map(b => typeof b === 'string' ? b.trim() : '')
    .filter(b => b.length > 0 && b.length < 200);

  if (cleanBrands.length === 0) {
    return res.status(400).json({ error: 'No valid brand names' });
  }

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const anthropicClient = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  send('start', { total: cleanBrands.length });

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < cleanBrands.length; i++) {
    const brandName = cleanBrands[i];

    send('brand-start', { index: i, brand: brandName });

    try {
      // 1. Resolve domain
      const { domain, method } = await resolveDomain(brandName, anthropicClient);

      // 2. Check if already in library — skip if so
      const existing = await findBrandByDomain(domain);
      if (existing) {
        skipped++;
        send('brand-skip', {
          index: i,
          brand: brandName,
          domain,
          reason: 'Already in library'
        });
        continue;
      }

      // 3. Discover best candidate
      const { candidate, brandfetchMeta, sourcesTried } = await discoverBestCandidate(domain);
      if (!candidate) {
        failed++;
        send('brand-fail', {
          index: i,
          brand: brandName,
          domain,
          reason: 'No logos found from any source'
        });
        continue;
      }

      // 4. Save it
      const savedAssets = await saveCandidate({
        brandName, domain, candidate, brandfetchMeta, sourcesTried
      });
      succeeded++;
      send('brand-done', {
        index: i,
        brand: brandName,
        domain,
        source: candidate.source,
        method,
        assetCount: savedAssets.length
      });
    } catch (err) {
      console.error(`[bulk-process] ${brandName} failed:`, err.message);
      failed++;
      send('brand-fail', {
        index: i,
        brand: brandName,
        reason: err.message || 'Unknown error'
      });
    }

    // Pause between brands — be polite to Brandfetch's free tier
    if (i < cleanBrands.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  send('done', {
    total: cleanBrands.length,
    succeeded,
    skipped,
    failed
  });
  res.end();
}
