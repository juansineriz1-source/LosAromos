/**
 * api/actividad.js — Lee actividad del día desde Google Sheets
 *
 * GET /api/actividad?fecha=YYYY-MM-DD
 * Devuelve: { registros: [...], novedades: [...] }
 *
 * Permite que cada dispositivo vea lo que registraron TODOS los dispositivos,
 * no solo lo que está en su IndexedDB local.
 */

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';

const COLUMNAS_REGISTROS = [
  'uuid', 'caravana', 'animal_uuid', 'peso_kg', 'estado_sanitario',
  'vacuna_aplicada', 'medicamento', 'dosis_ml', 'observaciones',
  'operador', 'fecha', 'hora', 'sincronizado', 'timestamp_local',
  'device_id', 'sync_intentos',
];

// ─── JWT / Auth ───────────────────────────────────────────────────────────────
async function obtenerAccessToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const email = SERVICE_ACCOUNT_EMAIL;
  const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claim  = btoa(JSON.stringify({
    iss: email, scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsigned = `${header}.${claim}`;

  const pemBody   = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt  = `${unsigned}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) throw new Error(`Token error: ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// ─── Leer hoja ────────────────────────────────────────────────────────────────
async function leerHoja(token, hoja) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(hoja + '!A:Z')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  return (await resp.json()).values || [];
}

// ─── Convertir filas → objetos filtrando por fecha ───────────────────────────
function parsearFilas(filas, columnas, fecha) {
  if (!filas.length) return [];
  const cabeceras = filas[0];
  const colFecha  = cabeceras.indexOf('fecha');

  return filas.slice(1)
    .filter(fila => fila[colFecha] === fecha)
    .map(fila => {
      const obj = {};
      columnas.forEach(col => {
        const idx = cabeceras.indexOf(col);
        obj[col]  = idx >= 0 ? (fila[idx] || '') : '';
      });
      return obj;
    });
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const fecha = req.query.fecha || new Date().toISOString().split('T')[0];

  try {
    const token = await obtenerAccessToken();

    const COLS_NOVEDAD       = ['uuid', 'fecha', 'hora', 'texto', 'operador', 'caravana', 'device_id'];
    const COLS_RECORRIDA_META = ['uuid', 'fecha', 'hora', 'operador', 'duracion_seg', 'storage_url', 'storage_key', 'audio_tipo', 'audio_size', 'timestamp_local', 'device_id'];
    const COLS_FOTO_META      = ['uuid', 'fecha', 'hora', 'operador', 'nombre_original', 'storage_url', 'storage_key', 'imagen_tipo', 'imagen_size', 'timestamp_local', 'device_id'];
    const COLS_VIDEO_META     = ['uuid', 'fecha', 'hora', 'operador', 'nombre_original', 'storage_url', 'storage_key', 'video_tipo', 'video_size', 'timestamp_local', 'device_id'];

    const [filasRegistros, filasNovedades, filasRecorridas, filasFootos, filasVideos] = await Promise.all([
      leerHoja(token, 'registros_manga'),
      leerHoja(token, 'novedades').catch(() => []),
      leerHoja(token, 'recorridas_meta').catch(() => []),
      leerHoja(token, 'fotos_meta').catch(() => []),
      leerHoja(token, 'videos_meta').catch(() => []),
    ]);

    const registros  = parsearFilas(filasRegistros,  COLUMNAS_REGISTROS,    fecha);
    const novedades  = parsearFilas(filasNovedades,  COLS_NOVEDAD,          fecha);
    const recorridas = parsearFilas(filasRecorridas, COLS_RECORRIDA_META,   fecha);
    const fotos      = parsearFilas(filasFootos,     COLS_FOTO_META,        fecha);
    const videos     = parsearFilas(filasVideos,     COLS_VIDEO_META,       fecha);

    return res.status(200).json({ fecha, registros, novedades, recorridas, fotos, videos });

  } catch (err) {
    console.error('[actividad]', err.message);
    return res.status(200).json({ fecha, registros: [], novedades: [], recorridas: [], fotos: [], videos: [], error: err.message });
  }
}
