import { put, del, list } from '@vercel/blob';

/**
 * Upload a buffer to Vercel Blob.
 * Path format: brands/{slug}/{type}-{variant}.{ext}
 * e.g. brands/virgin-atlantic/svg-default.svg
 */
export async function uploadAsset({ slug, type, variant, ext, buffer, contentType }) {
  const path = `brands/${slug}/${type}-${variant}.${ext}`;
  const blob = await put(path, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return {
    url: blob.url,
    path,
    sizeKb: Math.round(buffer.length / 1024)
  };
}

/** Delete a single asset by path. */
export async function deleteAsset(path) {
  await del(path);
}

/** List all assets for a brand. Used for cleanup. */
export async function listBrandAssets(slug) {
  const result = await list({ prefix: `brands/${slug}/` });
  return result.blobs;
}
