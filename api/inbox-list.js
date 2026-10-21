import { get, head, list } from '@vercel/blob';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function readJson(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function getFileDetails(pathname) {
  try {
    const details = await head(pathname);
    return {
      exists: true,
      size: Number(details?.size || 0),
      contentType: details?.contentType || 'application/octet-stream',
      uploadedAt: details?.uploadedAt ? new Date(details.uploadedAt).toISOString() : null,
    };
  } catch (error) {
    console.warn('Blob no longer exists; hiding stale inbox metadata', pathname);
    return {
      exists: false,
      size: 0,
      contentType: 'application/octet-stream',
      uploadedAt: null,
    };
  }
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

    try {
      const result = await list({ prefix: 'upload-metadata/', limit: 100 });
      const records = [];

      for (const blob of result.blobs) {
        try {
          const metadata = await readJson(blob.pathname);
          if (metadata?.blob?.pathname) records.push(metadata);
        } catch (error) {
          console.error('Failed to read upload metadata', blob.pathname, error);
        }
      }

      const enriched = await Promise.all(
        records.map(async (item) => ({
          item,
          details: await getFileDetails(item.blob.pathname),
        })),
      );

      const existing = enriched.filter(({ details }) => details.exists);
      existing.sort((a, b) => String(b.item.uploadedAt || '').localeCompare(String(a.item.uploadedAt || '')));

      return json({
        uploads: existing.map(({ item, details }) => ({
          uploadId: item.uploadId,
          uploadedAt: item.uploadedAt || details.uploadedAt,
          name: item.name || '',
          email: item.email || '',
          notes: item.notes || '',
          originalFilename: item.originalFilename || item.blob.pathname.split('/').pop(),
          pathname: item.blob.pathname,
          contentType: item.blob.contentType || details.contentType,
          size: details.size,
          downloadPath: `/api/inbox-file?pathname=${encodeURIComponent(item.blob.pathname)}`,
        })),
        cursor: result.cursor || null,
      });
    } catch (error) {
      console.error('Inbox list error:', error);
      return json({ error: 'Unable to load uploads.' }, 500);
    }
  },
};
