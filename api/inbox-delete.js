import { del, get } from '@vercel/blob';

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

function clean(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

async function readJson(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export default {
  async fetch(request) {
    if (request.method !== 'DELETE') return json({ error: 'Method not allowed.' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    const uploadId = clean(body?.uploadId, 100);
    const pathname = clean(body?.pathname, 500);
    const metadataPath = `upload-metadata/${uploadId}.json`;

    if (!uploadId || !pathname || pathname.startsWith('upload-metadata/')) {
      return json({ error: 'Invalid upload.' }, 400);
    }

    try {
      const metadata = await readJson(metadataPath);
      if (!metadata || metadata?.blob?.pathname !== pathname) {
        return json({ error: 'Upload record not found.' }, 404);
      }

      try {
        await del(pathname);
      } catch (error) {
        console.warn('File was already missing during inbox delete', pathname, error);
      }

      await del(metadataPath);
      return json({ ok: true });
    } catch (error) {
      console.error('Inbox delete error:', error);
      return json({ error: 'Unable to delete upload.' }, 500);
    }
  },
};
