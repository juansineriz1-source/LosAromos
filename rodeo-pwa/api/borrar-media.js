/**
 * api/borrar-media.js — Borrar un archivo de MinIO + marcar como eliminado en Sheets
 *
 * POST /api/borrar-media
 * Body: { storage_key, tabla, uuid }
 *   - storage_key: clave del objeto en MinIO (ej. "audio/2026-05-18/ana_123.webm")
 *   - tabla: "recorridas_meta" | "fotos_meta" | "videos_meta"
 *   - uuid: UUID del registro en Sheets (para encontrar la fila y marcarla)
 *
 * Respuesta: { ok: true }
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

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

async function deleteDeMinIO(endpoint, bucket, accessKey, secretKey, region, objectKey) {
  const host      = new URL(endpoint).host;
  const now       = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate   = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const credScope = `${dateStamp}/${region}/s3/aws4_request`;

  const encodedKey    = objectKey.split('/').map(encodeURIComponent).join('/');
  const canonicalUri  = `/${bucket}/${encodedKey}`;
  const emptyHash     = await sha256Hex('');
  const canonHeaders  = `host:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amzDate}\n`;
  const signedHdrs    = 'host;x-amz-content-sha256;x-amz-date';
  const canonReq      = `DELETE\n${canonicalUri}\n\n${canonHeaders}\n${signedHdrs}\n${emptyHash}`;

  const sts   = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${await sha256Hex(canonReq)}`;
  const kDate = await hmac('AWS4' + secretKey, dateStamp);
  const kReg  = await hmac(kDate,  region);
  const kSvc  = await hmac(kReg,   's3');
  const kSign = await hmac(kSvc,   'aws4_request');
  const sig   = toHex(await hmac(kSign, sts));

  const delUrl = `${endpoint}/${bucket}/${encodedKey}`;
  console.log('[borrar-media] DELETE →', delUrl);

  const resp = await fetch(delUrl, {
    method: 'DELETE',
    headers: {
      'x-amz-date':            amzDate,
      'x-amz-content-sha256':  emptyHash,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope},SignedHeaders=${signedHdrs},Signature=${sig}`,
    },
  });

  // MinIO devuelve 204 en borrado exitoso (o 404 si ya no existe — ambos OK)
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text();
    throw new Error(`MinIO DELETE ${resp.status}: ${txt.slice(0, 200)}`);
  }
  console.log('[borrar-media] MinIO DELETE OK:', resp.status);
}

// ─── Auth Google ──────────────────────────────────────────────────────────────
async function obtenerToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const now        = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const claim = btoa(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const unsigned  = `${header}.${claim}`;
  const pemBody   = privateKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBuffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig       = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${signature}`,
  });
  const { access_token } = await r.json();
  return access_token;
}

// Marcar fila como eliminada en Sheets (limpia storage_key y storage_url)
async function marcarEliminadoEnSheets(token, tabla, uuid) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
  if (!SHEET_ID) return; // No crítico si no está configurado

  // Leer la hoja para encontrar la fila por UUID
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabla + '!A:Z')}`;
  const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return;
  const data  = await r.json();
  const filas = data.values || [];
  if (filas.length < 2) return;

  const cabeceras = filas[0];
  const colUUID   = cabeceras.indexOf('uuid');
  const colKey    = cabeceras.indexOf('storage_key');
  const colUrl    = cabeceras.indexOf('storage_url');

  let filaNum = -1;
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][colUUID] === uuid) { filaNum = i + 1; break; }
  }
  if (filaNum < 0) return; // No encontrado — no es error

  // Construir fila actualizada: limpiar storage_key y storage_url, marcar deleted
  const filaActual = [...(filas[filaNum - 1] || [])];
  if (colKey >= 0) filaActual[colKey] = 'DELETED';
  if (colUrl >= 0) filaActual[colUrl] = 'DELETED';

  const rango = `${tabla}!A${filaNum}`;
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rango)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [filaActual] }),
    }
  );
  console.log('[borrar-media] Sheets marcado como DELETED, fila:', filaNum);
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Solo POST' });

  const ENDPOINT   = process.env.S3_ENDPOINT          || '';
  const BUCKET     = process.env.S3_BUCKET            || 'rodeo-aromos';
  const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID     || '';
  const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
  const REGION     = process.env.S3_REGION            || 'us-east-1';

  const { storage_key, tabla, uuid } = req.body || {};

  if (!storage_key) return res.status(400).json({ ok: false, error: 'Falta storage_key' });

  const TABLAS_VALIDAS = ['recorridas_meta', 'fotos_meta', 'videos_meta'];
  if (tabla && !TABLAS_VALIDAS.includes(tabla)) {
    return res.status(400).json({ ok: false, error: `Tabla inválida: ${tabla}` });
  }

  try {
    // 1. Borrar de MinIO
    if (ENDPOINT && ACCESS_KEY && SECRET_KEY) {
      await deleteDeMinIO(ENDPOINT, BUCKET, ACCESS_KEY, SECRET_KEY, REGION, storage_key);
    }

    // 2. Marcar como eliminado en Sheets (si se pasan tabla y uuid)
    if (tabla && uuid) {
      try {
        const token = await obtenerToken();
        await marcarEliminadoEnSheets(token, tabla, uuid);
      } catch (sheetErr) {
        // No fatal — el archivo ya fue borrado de MinIO
        console.warn('[borrar-media] Error marcando en Sheets:', sheetErr.message);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[borrar-media] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
