/**
 * api/animales.js — Lee el registro oficial de animales desde Google Sheets
 *
 * GET /api/animales
 *
 * Lee la hoja "LosAromos" y devuelve el estado actual de cada animal
 * (deduplica por Botón, queda la última fila = estado más reciente).
 *
 * Columnas:
 *   A=Botón  B=Caravana  C=Estado  D=Tiene_caravana  E=Tiene_botón
 *   F=TIPO   G=Color     H=Fecha   I=Comentario       J=Usuario
 *   K=FechaVacuna  L=Aftosa  M=Brucelosis  N=Carbunclo  O=Mancha
 *   P=Queratoconjuntivitis  Q=Otras
 *   S=Botón_viejo  T=Caravana_vieja  U=Estado_viejo  V=TIPO_viejo
 */

const SHEET_ID             = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA          = 'LosAromos';

// ─── Auth JWT ────────────────────────────────────────────────────────────────
async function obtenerAccessToken(scope = 'https://www.googleapis.com/auth/spreadsheets') {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const claim  = btoa(JSON.stringify({ iss: SERVICE_ACCOUNT_EMAIL, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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

// ─── Leer hoja ────────────────────────────────────────────────────────────────
async function leerHoja(token) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA + '!A:V')}`;  // A→V cubre vacunas + historico
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets error: ${resp.status}`);
  return (await resp.json()).values || [];
}

// ─── Parsear fila ─────────────────────────────────────────────────────────────
function parsearFila(fila, idx) {
  return {
    _rowIndex:       idx + 2,              // fila real en Sheet (1-indexed, +1 cabecera)
    boton:           fila[0]  || '',
    caravana:        fila[1]  || '',
    estado:          fila[2]  || '',
    tiene_caravana:  fila[3]  || '',
    tiene_boton:     fila[4]  || '',
    tipo:            fila[5]  || '',
    color:           fila[6]  || '',
    fecha:           fila[7]  || '',
    comentario:      fila[8]  || '',
    usuario:         fila[9]  || '',
    // vacunas (columnas K-Q)
    fecha_vacuna:              fila[10] || '',
    vac_aftosa:                fila[11] || '',
    vac_brucelosis:            fila[12] || '',
    vac_carbunclo:             fila[13] || '',
    vac_mancha:                fila[14] || '',
    vac_queratoconjuntivitis:  fila[15] || '',
    vac_otras:                 fila[16] || '',
    // historico (columnas S-V, índices 18-21)
    boton_viejo:     fila[18] || '',
    caravana_vieja:  fila[19] || '',
    estado_viejo:    fila[20] || '',
    tipo_viejo:      fila[21] || '',
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await obtenerAccessToken();
    const filas = await leerHoja(token);

    if (!filas.length) return res.status(200).json({ animales: [], total: 0 });

    // Saltear cabecera (fila 1)
    const datos = filas.slice(1).map((fila, idx) => parsearFila(fila, idx));

    // Deduplicar por Botón (o Caravana si no hay Botón):
    // la última aparición de cada animal = estado más reciente
    const mapaAnimales = new Map();
    datos.forEach(a => {
      const clave = a.boton || a.caravana;
      if (clave) mapaAnimales.set(clave, a);
    });

    const animales = Array.from(mapaAnimales.values());

    // Ordenar: primero por tipo, luego por botón
    animales.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (a.boton || '').localeCompare(b.boton || '');
    });

    return res.status(200).json({ animales, total: animales.length });

  } catch (err) {
    console.error('[animales]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
