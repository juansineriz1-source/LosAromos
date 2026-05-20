/**
 * api/vacunar.js — Registra la aplicación de una vacuna a un animal
 *
 * POST /api/vacunar
 * Body: { boton, caravana, vacuna, fecha, usuario, animal_actual }
 *
 * ESTRATEGIA: igual que actualizar-animal — agrega nueva fila al final
 * preservando todos los valores actuales del animal y marcando la vacuna
 * con la fecha indicada.
 *
 * Vacunas posibles: aftosa, brucelosis, carbunclo, mancha, queratoconjuntivitis, otras
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA           = 'LosAromos';

const VACUNAS_CAMPO = {
  aftosa:               'vac_aftosa',
  brucelosis:           'vac_brucelosis',
  carbunclo:            'vac_carbunclo',
  mancha:               'vac_mancha',
  queratoconjuntivitis: 'vac_queratoconjuntivitis',
  otras:                'vac_otras',
};

// ─── Auth JWT (mismo que los demás endpoints) ────────────────────────────────
async function obtenerAccessToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const claim  = btoa(JSON.stringify({ iss: SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${header}.${claim}`;
  const pemBody   = privateKey.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBuffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig       = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt  = `${unsigned}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) throw new Error(`Auth error: ${await resp.text()}`);
  return (await resp.json()).access_token;
}

async function appendFila(token, fila) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Sheets append error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Body inválido' });
  }

  const { vacuna, fecha, usuario, animal_actual } = body;
  const a = animal_actual;

  if (!a || !vacuna) {
    return res.status(400).json({ error: 'Faltan campos: vacuna, animal_actual' });
  }
  if (!VACUNAS_CAMPO[vacuna]) {
    return res.status(400).json({ error: `Vacuna desconocida: ${vacuna}` });
  }

  // Fecha de hoy si no se envía
  const hoy = new Date();
  const fechaHoy = fecha || `${hoy.getDate().toString().padStart(2,'0')}/${(hoy.getMonth()+1).toString().padStart(2,'0')}/${hoy.getFullYear()}`;

  // Construir la nueva fila copiando el animal actual y sobreescribiendo la vacuna elegida
  const vacunas = {
    fecha_vacuna:             a.fecha_vacuna             || fechaHoy,
    vac_aftosa:               a.vac_aftosa               || '',
    vac_brucelosis:           a.vac_brucelosis           || '',
    vac_carbunclo:            a.vac_carbunclo            || '',
    vac_mancha:               a.vac_mancha               || '',
    vac_queratoconjuntivitis: a.vac_queratoconjuntivitis || '',
    vac_otras:                a.vac_otras                || '',
  };

  // Marcar la vacuna seleccionada con la fecha
  vacunas[VACUNAS_CAMPO[vacuna]] = fechaHoy;
  // Actualizar fecha de vacuna al más reciente
  vacunas.fecha_vacuna = fechaHoy;

  const nuevaFila = [
    a.boton          || '',   // A
    a.caravana       || '',   // B
    a.estado         || '',   // C
    a.tiene_caravana || '',   // D
    a.tiene_boton    || '',   // E
    a.tipo           || '',   // F
    a.color          || '',   // G
    a.fecha          || '',   // H — conserva fecha original del registro
    a.comentario     || '',   // I
    usuario          || a.usuario || '',  // J
    vacunas.fecha_vacuna,             // K
    vacunas.vac_aftosa,               // L
    vacunas.vac_brucelosis,           // M
    vacunas.vac_carbunclo,            // N
    vacunas.vac_mancha,               // O
    vacunas.vac_queratoconjuntivitis, // P
    vacunas.vac_otras,                // Q
    '',                               // R — vacío
    a.boton_viejo     || '',          // S
    a.caravana_vieja  || '',          // T
    a.estado_viejo    || '',          // U
    a.tipo_viejo      || '',          // V
  ];

  try {
    const token = await obtenerAccessToken();
    await appendFila(token, nuevaFila);
    console.log('[vacunar] Vacuna registrada:', vacuna, 'para', a.boton || a.caravana, 'por', usuario);
    return res.status(200).json({ ok: true, vacuna, fecha: fechaHoy });
  } catch (err) {
    console.error('[vacunar]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
