/**
 * api/media-proxy.js — Proxy unificado para audio Y video desde MinIO
 *
 * GET /api/media-proxy?key=video/2026-05-18/ana_123.mov
 *
 * Sirve cualquier tipo de media desde MinIO con soporte de Range requests
 * (necesario para que <video> y <audio> hagan scrubbing).
 *
 * Reemplaza /api/audio.js para todos los tipos de media.
 */

export const config = { api: { responseLimit: false } };

const MIME_MAP = {
  webm: 'audio/webm',
  ogg:  'audio/ogg',
  mp3:  'audio/mpeg',
  m4a:  'audio/mp4',
  wav:  'audio/wav',
  mp4:  'video/mp4',
  mov:  'video/quicktime',
  '3gp': 'video/3gpp',
  mkv:  'video/x-matroska',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ENDPOINT = process.env.S3_ENDPOINT || '';
  const BUCKET   = process.env.S3_BUCKET   || 'rodeo-aromos';

  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Falta ?key=...' });
  if (!ENDPOINT) return res.status(500).json({ error: 'S3_ENDPOINT no configurado' });

  // Inferir content-type desde extensión del key
  const ext         = key.split('.').pop().toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  const isVideo     = contentType.startsWith('video/');

  const minioUrl = `${ENDPOINT}/${BUCKET}/${key}`;

  try {
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders['Range'] = req.headers.range;

    const upstream = await fetch(minioUrl, { headers: fetchHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      console.error('[media-proxy] MinIO error:', upstream.status, key);
      return res.status(upstream.status).json({ error: `MinIO devolvió ${upstream.status}` });
    }

    const upContentType   = upstream.headers.get('content-type')   || contentType;
    const upContentLength = upstream.headers.get('content-length');
    const upContentRange  = upstream.headers.get('content-range');
    const upAcceptRanges  = upstream.headers.get('accept-ranges')  || 'bytes';

    res.setHeader('Content-Type',  upContentType);
    res.setHeader('Accept-Ranges', upAcceptRanges);
    // Videos: no cachear demasiado (archivos grandes); audios: cachear 24h
    res.setHeader('Cache-Control', isVideo ? 'private, max-age=1800' : 'private, max-age=86400');

    if (upContentLength) res.setHeader('Content-Length', upContentLength);
    if (upContentRange)  res.setHeader('Content-Range',  upContentRange);

    res.status(upstream.status);

    const buffer = await upstream.arrayBuffer();
    res.end(Buffer.from(buffer));

  } catch (err) {
    console.error('[media-proxy] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
