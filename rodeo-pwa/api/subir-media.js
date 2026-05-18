/**
 * api/subir-media.js — Proxy server-side para subir audio/fotos/videos a MinIO
 *
 * El browser NO puede hacer PUT directo a MinIO porque MinIO bloquea CORS.
 * Este endpoint recibe el archivo en base64, lo sube a MinIO desde Vercel
 * (server-side, sin restricciones CORS) y devuelve publicUrl + objectKey.
 *
 * POST /api/subir-media
 * Body JSON: {
 *   tipo:        "audio" | "foto" | "video"
 *   base64:      "<base64 del binario>"
 *   mimeType:    "audio/webm" | "image/jpeg" | "video/mp4" | ...
 *   operador:    "Juan"
 * }
 * Respuesta: { ok: true, publicUrl, objectKey }
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },
    responseLimit: false,
  },
};

const ENDPOINT   = process.env.S3_ENDPOINT          || '';
const BUCKET     = process.env.S3_BUCKET            || 'rodeo-aromos';
const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID     || '';
const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
const REGION     = process.env.S3_REGION            || 'us-east-1';

// ─── AWS Signature v4 ─────────────────────────────────────────────────────────
async function hmac(key, data) {
  const k  = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)));
}
const toHex = buf => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(str) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))));
}
async function sha256Buf(buf) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)));
}

async function putAMinIO(objectKey, mimeType, bodyBuffer) {
  const host      = new URL(ENDPOINT).host;
  const now       = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate   = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const credScope = `${dateStamp}/${REGION}/s3/aws4_request`;

  const payloadHash = await sha256Buf(bodyBuffer);
  const encodedKey  = objectKey.split('/').map(encodeURIComponent).join('/');

  const canonHeaders = `content-type:${mimeType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHdrs   = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonReq     = `PUT\n/${BUCKET}/${encodedKey}\n\n${canonHeaders}\n${signedHdrs}\n${payloadHash}`;

  const sts  = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${await sha256Hex(canonReq)}`;
  const kD   = await hmac('AWS4' + SECRET_KEY, dateStamp);
  const kR   = await hmac(kD, REGION);
  const kS   = await hmac(kR, 's3');
  const kSig = await hmac(kS, 'aws4_request');
  const sig  = toHex(await hmac(kSig, sts));

  const uploadResp = await fetch(`${ENDPOINT}/${BUCKET}/${encodedKey}`, {
    method: 'PUT',
    headers: {
      'Content-Type':           mimeType,
      'x-amz-date':             amzDate,
      'x-amz-content-sha256':   payloadHash,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credScope},SignedHeaders=${signedHdrs},Signature=${sig}`,
    },
    body: bodyBuffer,
  });

  if (!uploadResp.ok) {
    const txt = await uploadResp.text();
    throw new Error(`MinIO PUT ${uploadResp.status}: ${txt.slice(0, 300)}`);
  }
}

// ─── Generar object key según tipo ────────────────────────────────────────────
const EXTENSIONES = {
  'audio/webm': 'webm', 'audio/webm;codecs=opus': 'webm',
  'audio/ogg': 'ogg',   'audio/mp4': 'm4a',  'audio/mpeg': 'mp3',
  'image/jpeg': 'jpg',  'image/png': 'png',  'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4',   'video/webm': 'webm','video/quicktime': 'mov', 'video/3gpp': '3gp',
};

function generarKey(tipo, operador, mimeType) {
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const op    = (operador || 'op').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext   = EXTENSIONES[mimeType] || mimeType.split('/')[1] || 'bin';
  return `${tipo}/${fecha}/${op}_${Date.now()}.${ext}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Solo POST' });

  if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY)
    return res.status(500).json({ ok: false, error: 'S3 no configurado — faltan env vars (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)' });

  const { tipo = 'media', base64, mimeType = 'application/octet-stream', operador = 'op' } = req.body || {};

  if (!base64) return res.status(400).json({ ok: false, error: 'Falta campo "base64"' });

  try {
    // Decodificar base64 → Uint8Array
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const objectKey = generarKey(tipo, operador, mimeType);
    await putAMinIO(objectKey, mimeType, bytes);

    const publicUrl = `${ENDPOINT}/${BUCKET}/${objectKey}`;
    console.log(`[subir-media] ${tipo} OK → ${publicUrl}`);

    return res.status(200).json({ ok: true, publicUrl, objectKey });

  } catch (err) {
    console.error('[subir-media]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
