import { put } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { randomUUID } from 'node:crypto';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const TOKEN_WINDOW_MS = 60 * 1000;
const TOKEN_LIMIT_PER_WINDOW = 10;
const tokenRequests = new Map();

const ALLOWED_CONTENT_TYPES = [
  'image/*',
  'audio/*',
  'video/*',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function safeFilename(value) {
  const cleaned = String(value ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);

  return cleaned || 'upload.bin';
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const existing = tokenRequests.get(ip);

  if (!existing || now - existing.startedAt >= TOKEN_WINDOW_MS) {
    tokenRequests.set(ip, { startedAt: now, count: 1 });
    return false;
  }

  existing.count += 1;
  return existing.count > TOKEN_LIMIT_PER_WINDOW;
}

function parseClientPayload(clientPayload) {
  let input = {};
  if (clientPayload) {
    try {
      input = JSON.parse(clientPayload);
    } catch {
      throw new Error('Invalid upload details.');
    }
  }

  if (cleanText(input.website, 200)) {
    throw new Error('Upload rejected.');
  }

  return {
    name: cleanText(input.name, 100),
    email: cleanText(input.email, 200),
    notes: cleanText(input.notes, 500),
  };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    if (body?.type === 'blob.generate-client-token') {
      const ip = getClientIp(request);
      if (isRateLimited(ip)) {
        return json({ error: 'Too many upload attempts. Please try again in a minute.' }, 429);
      }
    }

    try {
      const response = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const details = parseClientPayload(clientPayload);
          const uploadId = randomUUID();
          const date = new Date().toISOString().slice(0, 10);
          const filename = safeFilename(pathname);

          return {
            pathname: `incoming/${date}/${uploadId}-${filename}`,
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_FILE_SIZE,
            addRandomSuffix: false,
            tokenPayload: JSON.stringify({
              uploadId,
              originalFilename: filename,
              ...details,
            }),
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          let details = {};
          try {
            details = tokenPayload ? JSON.parse(tokenPayload) : {};
          } catch {
            details = {};
          }

          const uploadId = cleanText(details.uploadId, 100) || randomUUID();
          const metadata = {
            uploadId,
            uploadedAt: new Date().toISOString(),
            name: cleanText(details.name, 100),
            email: cleanText(details.email, 200),
            notes: cleanText(details.notes, 500),
            originalFilename: cleanText(details.originalFilename, 120),
            blob: {
              pathname: blob.pathname,
              contentType: blob.contentType,
              contentDisposition: blob.contentDisposition,
              url: blob.url,
              downloadUrl: blob.downloadUrl,
            },
          };

          await put(`upload-metadata/${uploadId}.json`, JSON.stringify(metadata, null, 2), {
            access: 'private',
            contentType: 'application/json',
            addRandomSuffix: false,
          });
        },
      });

      return json(response);
    } catch (error) {
      console.error('Upload handler error:', error);
      return json(
        { error: error instanceof Error ? error.message : 'Upload failed.' },
        400,
      );
    }
  },
};
