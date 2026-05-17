/**
 * api/push-subscribe.js
 *
 * Guarda la suscripción Web Push de un dispositivo en Google Sheets.
 * Se llama cuando la app pide permiso de notificaciones por primera vez
 * o cuando se renueva la suscripción.
 *
 * Hoja: "push_subs" con columnas:
 *   device_id | operador | endpoint | p256dh | auth | fecha | activo
 */

const SHEET_ID             = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const HOJA                 = 'push_subs';
const COLUMNAS             = ['device_id', 'operador', 'endpoint', 'p256dh', 'auth', 'fecha', 'activo'];

// ─── Auth Google (reutiliza misma lógica que sincronizar.js) ─────────────────
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

async function leerHoja(token, rango = 'A:G') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA + '!' + rango)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d.values || [];
}

async function escribirFila(token, fila) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [fila] }),
  });
}

async function actualizarFila(token, numFila, fila) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA + '!A' + numFila)}?valueInputOption=RAW`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [fila] }),
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: devuelve la VAPID public key para que el cliente pueda suscribirse
  if (req.method === 'GET') {
    return res.status(200).json({
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { device_id, operador, subscription } = req.body;
    if (!device_id || !subscription?.endpoint) {
      return res.status(400).json({ ok: false, error: 'Faltan campos' });
    }

    const token = await obtenerToken();
    const filas = await leerHoja(token);

    // Asegurar cabeceras
    if (!filas.length) {
      await escribirFila(token, COLUMNAS);
    }

    const colDeviceId = 0;
    let filaExistente = -1;
    for (let i = 1; i < filas.length; i++) {
      if (filas[i][colDeviceId] === device_id) {
        filaExistente = i + 1;
        break;
      }
    }

    const fila = [
      device_id,
      operador || 'Operador',
      subscription.endpoint,
      subscription.keys?.p256dh || '',
      subscription.keys?.auth   || '',
      new Date().toISOString().split('T')[0],
      'true',
    ];

    if (filaExistente > 0) {
      await actualizarFila(token, filaExistente, fila);
    } else {
      await escribirFila(token, fila);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[push-subscribe]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
