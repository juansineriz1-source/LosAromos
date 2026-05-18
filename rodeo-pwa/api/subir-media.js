/**
 * api/subir-media.js — Proxy server-side para subir audio/fotos/videos a MinIO
 *
 * POST /api/subir-media
 * Body JSON: { tipo, base64, mimeType, operador }
 * Respuesta: { ok: true, publicUrl, objectKey }
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },
    responseLimit: false,
  },
};

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

async function putAMinIO(endpoint, bucket, accessKey, secretKey, region, objectKey, mimeType, bodyBuffer) {
  const host      = new URL(endpoint).host;                               // storage.losaromos.online
  const now       = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');    // YYYYMMDD
  const amzDate   = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ
  const credScope = `${dateStamp}/${region}/s3/aws4_request`;

  // Limpiar mimeType — quitar ";codecs=opus" etc. que rompen la firma
  const cleanMime = mimeType.split(';')[0].trim();

  // Codificar cada segmento del key (preservar /)
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');

  // URL canónica: path-style para MinIO (bucket en el path, NO en el hostname)
  const canonicalUri = `/${bucket}/${encodedKey}`;

  const payloadHash    = await sha256Buf(bodyBuffer);
  const canonHeaders   = `content-type:${cleanMime}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHdrs     = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonReq       = `PUT\n${canonicalUri}\n\n${canonHeaders}\n${signedHdrs}\n${payloadHash}`;

  const sts    = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${await sha256Hex(canonReq)}`;
  const kDate  = await hmac('AWS4' + secretKey, dateStamp);
  const kReg   = await hmac(kDate,  region);
  const kSvc   = await hmac(kReg,   's3');
  const kSign  = await hmac(kSvc,   'aws4_request');
  const sig    = toHex(await hmac(kSign, sts));

  const putUrl = `${endpoint}/${bucket}/${encodedKey}`;

  console.log('[subir-media] PUT →', putUrl, '| mimeType:', cleanMime, '| size:', bodyBuffer.length);

  const uploadResp = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      'Content-Type':          cleanMime,
      'x-amz-date':            amzDate,
      'x-amz-content-sha256':  payloadHash,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope},SignedHeaders=${signedHdrs},Signature=${sig}`,
    },
    body: bodyBuffer,
  });

  if (!uploadResp.ok) {
    const txt = await uploadResp.text();
    console.error('[subir-media] MinIO error:', uploadResp.status, txt.slice(0, 500));
    throw new Error(`MinIO ${uploadResp.status}: ${txt.slice(0, 200)}`);
  }

  console.log('[subir-media] MinIO OK:', uploadResp.status);
}

function generarKey(tipo, operador, mimeType) {
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const op    = (operador || 'op').toLowerCase().replace(/[^a-z0-9]/g, '');
  const EXTS  = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
    'image/jpeg': 'jpg',  'image/png': 'png',  'image/webp': 'webp', 'image/heic': 'heic',
    'video/mp4': 'mp4',   'video/webm': 'webm','video/quicktime': 'mov', 'video/3gpp': '3gp',
  };
  const cleanMime = mimeType.split(';')[0].trim();
  const ext   = EXTS[cleanMime] || cleanMime.split('/')[1] || 'bin';
  return `${tipo}/${fecha}/${op}_${Date.now()}.${ext}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Solo POST' });

  // Leer env vars DENTRO del handler (no en top-level)
  const ENDPOINT   = process.env.S3_ENDPOINT          || '';
  const BUCKET     = process.env.S3_BUCKET            || 'rodeo-aromos';
  const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID     || '';
  const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
  const REGION     = process.env.S3_REGION            || 'us-east-1';

  // Diagnóstico de env vars en cada request (aparece en Vercel Logs)
  const envOK = { ENDPOINT: !!ENDPOINT, BUCKET: !!BUCKET, ACCESS_KEY: !!ACCESS_KEY, SECRET_KEY: !!SECRET_KEY, REGION: !!REGION };
  console.log('[subir-media] Env vars:', JSON.stringify(envOK));

  const faltantes = Object.entries(envOK).filter(([, v]) => !v).map(([k]) => k);
  if (faltantes.length > 0) {
    const msg = `S3 no configurado. Faltan: ${faltantes.join(', ')}`;
    console.error('[subir-media]', msg);
    return res.status(500).json({ ok: false, error: msg });
  }

  const { tipo = 'media', base64, mimeType = 'application/octet-stream', operador = 'op' } = req.body || {};

  if (!base64) return res.status(400).json({ ok: false, error: 'Falta campo "base64"' });

  try {
    // Decodificar base64 → Buffer (Node.js nativo, sin atob())
    const bodyBuffer = Buffer.from(base64, 'base64');
    console.log('[subir-media] Buffer size:', bodyBuffer.length, 'bytes | tipo:', tipo, '| mime:', mimeType);

    const objectKey = generarKey(tipo, operador, mimeType);

    await putAMinIO(ENDPOINT, BUCKET, ACCESS_KEY, SECRET_KEY, REGION, objectKey, mimeType, bodyBuffer);

    const publicUrl = `${ENDPOINT}/${BUCKET}/${objectKey}`;
    console.log('[subir-media] Éxito →', publicUrl);

    return res.status(200).json({ ok: true, publicUrl, objectKey });

  } catch (err) {
    console.error('[subir-media] Error final:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
