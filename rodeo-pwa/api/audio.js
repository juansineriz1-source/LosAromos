/**
 * api/audio.js — Proxy de audio para MinIO
 *
 * GET /api/audio?key=recorrida/2026-05-17/juan_abc123.webm
 *
 * Fetch el binario desde MinIO (server-side → sin CORS) y lo sirve
 * al browser con los headers correctos para reproducción de audio.
 * También maneja Range requests para que el scrubbing funcione.
 */

const ENDPOINT   = process.env.S3_ENDPOINT || '';
const BUCKET     = process.env.S3_BUCKET   || 'rodeo-aromos';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Falta ?key=...' });

  if (!ENDPOINT) return res.status(500).json({ error: 'S3_ENDPOINT no configurado' });

  const minioUrl = `${ENDPOINT}/${BUCKET}/${key}`;

  try {
    // Pasar el header Range si el browser lo envía (para scrubbing de audio)
    const fetchHeaders = {};
    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const upstream = await fetch(minioUrl, { headers: fetchHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      console.error('[audio-proxy] MinIO error:', upstream.status, minioUrl);
      return res.status(upstream.status).json({ error: `MinIO devolvió ${upstream.status}` });
    }

    // Copiar headers relevantes al response
    const contentType   = upstream.headers.get('content-type')   || 'audio/webm';
    const contentLength = upstream.headers.get('content-length');
    const contentRange  = upstream.headers.get('content-range');
    const acceptRanges  = upstream.headers.get('accept-ranges')  || 'bytes';

    res.setHeader('Content-Type',   contentType);
    res.setHeader('Accept-Ranges',  acceptRanges);
    res.setHeader('Cache-Control',  'private, max-age=3600');

    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange)  res.setHeader('Content-Range',  contentRange);

    res.status(upstream.status);

    // Stream del binario
    const buffer = await upstream.arrayBuffer();
    res.end(Buffer.from(buffer));

  } catch (err) {
    console.error('[audio-proxy] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
