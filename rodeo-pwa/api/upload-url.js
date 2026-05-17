/**
 * api/upload-url.js — Genera una URL pre-firmada para subir archivos directo al MinIO
 *
 * Flujo:
 *   1. La PWA pide una URL firmada con el tipo y nombre del archivo
 *   2. Este endpoint genera la URL (válida por 15 min) usando AWS Signature v4
 *   3. La PWA sube el archivo directamente a MinIO (sin pasar por Vercel)
 *   4. MinIO recibe el binario → queda en storage.losaromos.online/rodeo-aromos/
 *
 * Variables de entorno requeridas en Vercel:
 *   S3_ENDPOINT        = https://storage.losaromos.online
 *   S3_BUCKET          = rodeo-aromos
 *   S3_ACCESS_KEY_ID   = (generado en consola MinIO)
 *   S3_SECRET_ACCESS_KEY = (generado en consola MinIO)
 *   S3_REGION          = us-east-1  (MinIO acepta cualquier valor)
 */

const ENDPOINT    = process.env.S3_ENDPOINT        || '';
const BUCKET      = process.env.S3_BUCKET          || 'rodeo-aromos';
const ACCESS_KEY  = process.env.S3_ACCESS_KEY_ID   || '';
const SECRET_KEY  = process.env.S3_SECRET_ACCESS_KEY || '';
const REGION      = process.env.S3_REGION          || 'us-east-1';

// ─── AWS Signature v4 (sin SDK externo) ───────────────────────────────────────

async function hmac(key, data) {
  const k = typeof key === 'string'
    ? new TextEncoder().encode(key)
    : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  );
}

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return toHex(new Uint8Array(buf));
}

/**
 * Genera una URL pre-firmada para PUT (subida directa al bucket).
 * La URL expira en 15 minutos.
 */
async function generarPresignedPut({ objectKey, expiresIn = 900 }) {
  const host      = new URL(ENDPOINT).host;
  const service   = 's3';
  const now       = new Date();

  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');        // YYYYMMDD
  const amzDate   = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ

  const credScope  = `${dateStamp}/${REGION}/${service}/aws4_request`;
  const credential = `${ACCESS_KEY}/${credScope}`;

  // ─── URI canónica: path-style → /{bucket}/{key} ───────────────────────────
  // Cada segmento del key se codifica individualmente (las / se preservan).
  const encodedKey = objectKey.split('/').map(s => encodeURIComponent(s)).join('/');
  const canonicalUri = `/${BUCKET}/${encodedKey}`;

  // ─── Query string canónica (DEBE estar ordenada lexicográficamente) ───────
  const qp = [
    ['X-Amz-Algorithm',   'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential',  credential],
    ['X-Amz-Date',        amzDate],
    ['X-Amz-Expires',     String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ].sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQuery = qp
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders    = 'host';
  const payloadHash      = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // ─── String to sign ───────────────────────────────────────────────────────
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // ─── Signing key ──────────────────────────────────────────────────────────
  const kDate    = await hmac(`AWS4${SECRET_KEY}`, dateStamp);
  const kRegion  = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');

  const signature = toHex(await hmac(kSigning, stringToSign));

  // ─── URL final ────────────────────────────────────────────────────────────
  const url = `${ENDPOINT}/${BUCKET}/${objectKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url;
}

// ─── Helper: genera nombre de archivo único ────────────────────────────────
function generarObjectKey(tipo, operador, extension) {
  const fecha    = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();
  const opLimpio = (operador || 'anonimo').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${tipo}/${fecha}/${opLimpio}-${timestamp}.${extension}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', servicio: 'RodeoApp Upload API', bucket: BUCKET });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'S3 no configurado — falta env vars' });
  }

  try {
    const { tipo, contentType, operador } = req.body;

    // tipo: 'recorrida' | 'foto' | 'novedad'
    if (!tipo || !contentType) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: tipo, contentType' });
    }

    // Determinar extensión según MIME type
    const EXTENSIONES = {
      'audio/webm':             'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/ogg':              'ogg',
      'audio/mp4':              'mp4',
      'audio/mpeg':             'mp3',
      'image/jpeg':             'jpg',
      'image/png':              'png',
      'image/webp':             'webp',
      'video/mp4':              'mp4',
      'video/webm':             'webm',
      'video/quicktime':        'mov',
      'video/3gpp':             '3gp',
      'video/x-msvideo':        'avi',
    };
    const extension = EXTENSIONES[contentType] || contentType.split('/')[1] || 'bin';
    const objectKey = generarObjectKey(tipo, operador, extension);

    const presignedUrl = await generarPresignedPut({
      objectKey,
      contentType,
      expiresIn: 900, // 15 minutos
    });

    // URL pública de acceso (para reproducir/ver después)
    const publicUrl = `${ENDPOINT}/${BUCKET}/${objectKey}`;

    return res.status(200).json({
      ok: true,
      uploadUrl: presignedUrl,
      publicUrl,
      objectKey,
      expiresIn: 900,
    });

  } catch (error) {
    console.error('[API upload-url]', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
