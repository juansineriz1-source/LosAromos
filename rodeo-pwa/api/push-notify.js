/**
 * api/push-notify.js
 *
 * Envía Web Push a todos los dispositivos suscritos EXCEPTO al que generó el evento.
 * Llamado internamente desde /api/sincronizar luego de guardar un registro.
 *
 * Body esperado:
 *   { sender_device_id, titulo, cuerpo, data? }
 */

import webpush from 'web-push';

const SHEET_ID              = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const HOJA                  = 'push_subs';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'app@losaromos.online'}`,
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

// ─── Auth Google ──────────────────────────────────────────────────────────────
async function obtenerToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claim = btoa(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${header}.${claim}`;
  const pemBody = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${unsigned}.${signature}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const { access_token } = await r.json();
  return access_token;
}

async function obtenerSuscripciones(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA + '!A:G')}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  const filas = d.values || [];
  if (filas.length < 2) return [];

  // Cabeceras: device_id | operador | endpoint | p256dh | auth | fecha | activo
  return filas.slice(1)
    .filter(f => f[6] !== 'false' && f[2]) // solo activos con endpoint
    .map(f => ({
      device_id: f[0],
      operador:  f[1],
      endpoint:  f[2],
      p256dh:    f[3],
      auth:      f[4],
    }));
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  console.log('[push-notify] Solicitud recibida');

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error('[push-notify] VAPID keys no configuradas en env vars');
    return res.status(500).json({ ok: false, error: 'VAPID keys no configuradas' });
  }
  console.log('[push-notify] VAPID keys OK');

  try {
    const { sender_device_id, titulo, cuerpo, data = {} } = req.body;

    if (!titulo || !cuerpo) {
      return res.status(400).json({ ok: false, error: 'Faltan titulo y cuerpo' });
    }

    console.log('[push-notify] Obteniendo token Google...');
    const token = await obtenerToken();
    console.log('[push-notify] Token OK, leyendo suscripciones...');
    const suscripciones = await obtenerSuscripciones(token);
    console.log('[push-notify] Suscripciones encontradas en Sheets:', suscripciones.length);

    // Filtrar al que mandó el evento
    const destinatarios = suscripciones.filter(s =>
      s.device_id !== sender_device_id && s.endpoint && s.p256dh && s.auth
    );
    console.log('[push-notify] Destinatarios válidos (excl. sender):', destinatarios.length);

    if (destinatarios.length === 0) {
      return res.status(200).json({ ok: true, enviadas: 0, mensaje: 'Sin otros destinatarios', total_subs: suscripciones.length });
    }

    const payload = JSON.stringify({
      titulo,
      cuerpo,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      data:  { url: '/', ...data },
    });

    // Enviar en paralelo — ignorar errores individuales (suscripción expirada)
    const resultados = await Promise.allSettled(
      destinatarios.map(s =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 } // 1 hora de TTL
        )
      )
    );

    const enviadas = resultados.filter(r => r.status === 'fulfilled').length;
    const fallidas = resultados.filter(r => r.status === 'rejected').length;

    // Loguear razón de fallas
    resultados.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[push-notify] Falla ${i}:`, r.reason?.message || r.reason);
      }
    });

    console.log(`[push-notify] Enviadas: ${enviadas}, Fallidas: ${fallidas}`);
    return res.status(200).json({ ok: true, enviadas, fallidas, total_subs: suscripciones.length });

  } catch (err) {
    console.error('[push-notify] Error general:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
