/**
 * api/actualizar-animal.js — Actualiza un animal en Google Sheets
 *
 * POST /api/actualizar-animal
 *
 * ESTRATEGIA DE TRAZABILIDAD:
 * Nunca modifica filas existentes. Agrega una nueva fila al final con los
 * nuevos valores. En columnas L-O se registran los valores ANTERIORES para
 * mantener historial completo de cambios.
 *
 * Columnas de la nueva fila:
 *   A=Botón nuevo    B=Caravana nueva    C=Estado nuevo
 *   D=Tiene_caravana E=Tiene_botón      F=TIPO nuevo
 *   G=Color          H=Fecha_hoy        I=Comentario
 *   J=Usuario        K=Fecha_vacuna (se preserva) L=Aftosa  M=Brucelosis
 *   N=Carbunclo  O=Mancha  P=Queratoconjuntivitis  Q=Otras
 *   R=(vacía)   S=Botón viejo  T=Caravana vieja  U=Estado viejo  V=TIPO viejo
 */

const SHEET_ID             = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA          = 'LosAromos';

// ─── Auth JWT ────────────────────────────────────────────────────────────────
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

// ─── Append fila al final del Sheet ──────────────────────────────────────────
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

// ─── Handler ──────────────────────────────────────────────────────────────────
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

  const {
    // Nuevos valores de identidad/estado
    boton, caravana, estado, tiene_caravana, tiene_boton,
    tipo, color, comentario, usuario,
    // Vacunas (se preservan desde el animal actual)
    fecha_vacuna, vac_aftosa, vac_brucelosis, vac_carbunclo,
    vac_mancha, vac_queratoconjuntivitis, vac_otras,
    // Valores anteriores (para historial en cols S-V)
    boton_viejo, caravana_vieja, estado_viejo, tipo_viejo,
  } = body;

  if (!boton && !caravana) {
    return res.status(400).json({ error: 'Se requiere Botón o Caravana' });
  }

  // Fecha de hoy en formato DD/MM/YYYY (igual al formato del sheet)
  const hoy = new Date();
  const fechaHoy = `${hoy.getDate().toString().padStart(2,'0')}/${(hoy.getMonth()+1).toString().padStart(2,'0')}/${hoy.getFullYear()}`;

  // Nueva fila: A-J + vacunas K-Q + R vacío + S-V histórico
  const nuevaFila = [
    boton           || '',   // A — Botón nuevo
    caravana        || '',   // B — Caravana nueva
    estado          || '',   // C — Estado nuevo
    tiene_caravana  || '',   // D — Tiene caravana
    tiene_boton     || '',   // E — Tiene botón
    tipo            || '',   // F — TIPO nuevo
    color           || '',   // G — Color
    fechaHoy,               // H — Fecha de actualización
    comentario      || '',   // I — Comentario
    usuario         || '',   // J — Usuario que actualizó
    fecha_vacuna              || '',   // K — Fecha vacuna (preservada)
    vac_aftosa                || '',   // L — Aftosa
    vac_brucelosis            || '',   // M — Brucelosis
    vac_carbunclo             || '',   // N — Carbunclo
    vac_mancha                || '',   // O — Mancha
    vac_queratoconjuntivitis  || '',   // P — Queratoconjuntivitis
    vac_otras                 || '',   // Q — Otras
    '',                     // R — (vacío)
    boton_viejo     || '',   // S — Botón viejo
    caravana_vieja  || '',   // T — Caravana vieja
    estado_viejo    || '',   // U — Estado viejo
    tipo_viejo      || '',   // V — TIPO viejo
  ];

  try {
    const token = await obtenerAccessToken();
    const result = await appendFila(token, nuevaFila);

    console.log('[actualizar-animal] Fila agregada:', boton || caravana, '→ actualizado por', usuario);

    return res.status(200).json({
      ok: true,
      mensaje: `Animal ${boton || caravana} actualizado`,
      fila_agregada: result.updates?.updatedRange || 'ok',
    });

  } catch (err) {
    console.error('[actualizar-animal]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
