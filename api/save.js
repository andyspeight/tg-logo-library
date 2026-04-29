import sharp from 'sharp';
import { fetchBrand } from './_lib/brandfetch.js';
import { uploadAsset } from './_lib/blob.js';
import { makeTransparentPng, slugify, getSvgMetadata } from './_lib/image-utils.js';
import { findBrandByDomain, createBrand, updateBrand, createAsset, logDiscovery } from './_lib/airtable.js';
import { checkAdminPassword, denyUnauthorized, rateLimit, denyRateLimit } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAdminPassword(req)) return denyUnauthorized(res);

  const rl = await rateLimit(req, 'save', 10, '1 m');
  if (!rl.ok) return denyRateLimit(res, rl.reset);

  const {
    brandName,
    domain,
    selectedUrl,
    selectedSource,
    category,
    tgSupplier,
    notes,
    sourcesTried,
    sourcesSucceeded
  } = req.body || {};

  // Input validation
  if (!brandName || !domain || !selectedUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (brandName.length > 200 || domain.length > 200 || selectedUrl.length > 1000) {
    return res.status(400).json({ error: 'Field too long' });
  }
  if (!/^https?:\/\//.test(selectedUrl)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const slug = slugify(brandName);

    // 1. Fetch the chosen image
    const imgRes = await fetch(selectedUrl);
    if (!imgRes.ok) {
      return res.status(502).json({ error: 'Could not fetch source image' });
    }
    const contentType = imgRes.headers.get('content-type') || '';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const isSvg = contentType.includes('svg') || selectedUrl.toLowerCase().endsWith('.svg');

    // 2. Get brand colours from Brandfetch if available
    const brandfetchData = await fetchBrand(domain);

    // 3. Find or create the brand record
    let brandRecord = await findBrandByDomain(domain);
    if (!brandRecord) {
      brandRecord = await createBrand({
        name: brandName,
        domain,
        category: category || 'Other',
        colourPrimary: brandfetchData?.colourPrimary || '',
        colourSecondary: brandfetchData?.colourSecondary || '',
        notes: notes || '',
        tgSupplier: !!tgSupplier
      });
    } else {
      brandRecord = await updateBrand(brandRecord.id, {
        category,
        tgSupplier,
        notes,
        colourPrimary: brandfetchData?.colourPrimary || undefined,
        colourSecondary: brandfetchData?.colourSecondary || undefined
      });
    }

    const savedAssets = [];

    // 4. Save the original (SVG or PNG)
    if (isSvg) {
      const meta = getSvgMetadata(buffer);
      const upload = await uploadAsset({
        slug,
        type: 'svg',
        variant: 'default',
        ext: 'svg',
        buffer,
        contentType: 'image/svg+xml'
      });
      const asset = await createAsset({
        assetId: `${slug}-svg-default`,
        brandRecordId: brandRecord.id,
        type: 'SVG',
        variant: 'Default',
        source: selectedSource,
        fileUrl: upload.url,
        width: meta.width,
        height: meta.height,
        fileSizeKb: upload.sizeKb,
        originalUrl: selectedUrl
      });
      savedAssets.push({ type: 'SVG', url: upload.url, recordId: asset.id });
    } else {
      // Save the original PNG
      const png = await sharp(buffer).png().toBuffer();
      const meta = await sharp(png).metadata();
      const upload = await uploadAsset({
        slug,
        type: 'png-original',
        variant: 'default',
        ext: 'png',
        buffer: png,
        contentType: 'image/png'
      });
      const asset = await createAsset({
        assetId: `${slug}-png-original-default`,
        brandRecordId: brandRecord.id,
        type: 'PNG-Original',
        variant: 'Default',
        source: selectedSource,
        fileUrl: upload.url,
        width: meta.width || 0,
        height: meta.height || 0,
        fileSizeKb: upload.sizeKb,
        originalUrl: selectedUrl
      });
      savedAssets.push({ type: 'PNG-Original', url: upload.url, recordId: asset.id });
    }

    // 5. Generate and save transparent PNG (always — even if source was SVG, we rasterise)
    let transparentBuffer;
    let transparentMeta;
    if (isSvg) {
      // Rasterise SVG to 1024px wide PNG, then make transparent
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
      slug,
      type: 'png-transparent',
      variant: 'default',
      ext: 'png',
      buffer: transparentBuffer,
      contentType: 'image/png'
    });
    const transAsset = await createAsset({
      assetId: `${slug}-png-transparent-default`,
      brandRecordId: brandRecord.id,
      type: 'PNG-Transparent',
      variant: 'Default',
      source: 'Generated',
      fileUrl: transUpload.url,
      width: transparentMeta.width,
      height: transparentMeta.height,
      fileSizeKb: transUpload.sizeKb,
      originalUrl: selectedUrl
    });
    savedAssets.push({ type: 'PNG-Transparent', url: transUpload.url, recordId: transAsset.id });

    // 6. Log the discovery
    await logDiscovery({
      brandSearched: brandName,
      resolvedDomain: domain,
      sourcesTried: Array.isArray(sourcesTried) ? sourcesTried : [],
      sourcesSucceeded: Array.isArray(sourcesSucceeded) ? sourcesSucceeded : [],
      selectedSource: selectedSource || 'Unknown',
      notes: `Saved ${savedAssets.length} assets`
    });

    return res.json({
      ok: true,
      brand: {
        recordId: brandRecord.id,
        name: brandName,
        domain,
        slug
      },
      assets: savedAssets
    });
  } catch (err) {
    console.error('[save] Failed:', err);
    return res.status(500).json({ error: 'Save failed' });
  }
}
