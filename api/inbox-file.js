import { get } from '@vercel/blob';

function safeDownloadName(pathname) {
  const name = String(pathname || '').split('/').pop() || 'download';
  return name.replace(/[\r\n"]/g, '_');
}

function isAllowedPath(pathname) {
  if (!pathname || pathname.length > 500) return false;
  if (pathname.startsWith('upload-metadata/')) return false;
  return true;
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const pathname = url.searchParams.get('pathname') || '';

    if (!isAllowedPath(pathname)) {
      return new Response('Invalid file path', { status: 400 });
    }

    try {
      const result = await get(pathname, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200) {
        return new Response('File not found', { status: 404 });
      }

      const filename = safeDownloadName(pathname);
      return new Response(result.stream, {
        status: 200,
        headers: {
          'content-type': result.blob.contentType || 'application/octet-stream',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      console.error('Inbox file error:', error);
      return new Response('Unable to download file', { status: 500 });
    }
  },
};
