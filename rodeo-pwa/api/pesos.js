/**
 * api/pesos.js
 *
 * GET  /api/pesos?caravana=XXX          → historial de pesos de un animal
 * GET  /api/pesos?caravana=XXX&limit=5  → últimos N registros
 * GET  /api/pesos                       → todos los pesos (para gráficos globales)
 * POST /api/pesos  { caravana, boton, tipo, fecha, peso_kg, observaciones, operador }
 *
 * Hoja "Pesos" — columnas A:H:
 *   A=caravana  B=boton  C=tipo  D=fecha  E=peso_kg  F=observaciones  G=operador  H=timestamp
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const HOJA_PESOS            = 'Pesos';

// ─── Auth JWT ─────────────────────────────────────────────────────────────────
async function obtenerAccessToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now    = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const claim  = btoa(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned  = `${header}.${claim}`;
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

// ─── Leer toda la hoja Pesos ──────────────────────────────────────────────────
async function leerPesos(token) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA_PESOS + '!A:H')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  const filas = (await resp.json()).values || [];
  if (filas.length <= 1) return [];

  // Leer por posición (columnas fijas A:H)
  return filas.slice(1)
    .filter(f => f[0] || f[1]) // al menos caravana o boton
    .map(f => ({
      caravana:      (f[0] || '').trim(),
      boton:         (f[1] || '').trim(),
      tipo:          (f[2] || '').trim(),
      fecha:         (f[3] || '').trim(),
      peso_kg:       parseFloat(f[4]) || 0,
      observaciones: (f[5] || '').trim(),
      operador:      (f[6] || '').trim(),
      timestamp:     (f[7] || '').trim(),
    }))
    .filter(r => r.peso_kg > 0); // solo registros con peso válido
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await obtenerAccessToken();

    // ── POST: guardar nuevo peso ───────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { caravana, boton, tipo, fecha, peso_kg, observaciones, operador } = body;

      if (!caravana && !boton)    return res.status(400).json({ error: 'Se requiere caravana o boton' });
      if (!peso_kg || peso_kg <= 0 || peso_kg > 1500)
                                   return res.status(400).json({ error: 'peso_kg inválido (1-1500 kg)' });

      const fechaAR  = fecha || new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
      const tsAR     = new Date().toLocaleString('es-AR',  { timeZone: 'America/Argentina/Buenos_Aires' });

      const nuevaFila = [
        caravana      || '',  // A
        boton         || '',  // B
        tipo          || '',  // C
        fechaAR,              // D
        peso_kg,              // E
        observaciones || '',  // F
        operador      || '',  // G
        tsAR,                 // H
      ];

      const appendUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA_PESOS + '!A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const appendResp = await fetch(appendUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [nuevaFila] }),
      });
      if (!appendResp.ok) throw new Error(`Sheets append error: ${appendResp.status} ${await appendResp.text()}`);

      console.log('[pesos] ✅ Nuevo peso:', caravana || boton, '→', peso_kg, 'kg por', operador);
      return res.status(200).json({ ok: true, peso_kg, fecha: fechaAR });
    }

    // ── GET: leer pesos ────────────────────────────────────────────────────────
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const todos = await leerPesos(token);
    const { caravana, boton, limit } = req.query;

    // Filtrar por animal si se pide
    if (caravana || boton) {
      const cLow = (caravana || '').trim().toLowerCase();
      const bLow = (boton    || '').trim().toLowerCase();
      let filtrados = todos.filter(r =>
        (cLow && r.caravana.toLowerCase() === cLow) ||
        (bLow && r.boton.toLowerCase()    === bLow)
      );
      // Ordenar por fecha descendente (más reciente primero)
      filtrados.sort((a, b) => {
        const fa = a.fecha.split('/').reverse().join('-');
        const fb = b.fecha.split('/').reverse().join('-');
        return fb.localeCompare(fa);
      });
      if (limit) filtrados = filtrados.slice(0, parseInt(limit));
      return res.status(200).json({ pesos: filtrados, total: filtrados.length });
    }

    // Sin filtro → devolver todos ordenados por fecha desc
    todos.sort((a, b) => {
      const fa = a.fecha.split('/').reverse().join('-');
      const fb = b.fecha.split('/').reverse().join('-');
      return fb.localeCompare(fa);
    });
    return res.status(200).json({ pesos: todos, total: todos.length });

  } catch (err) {
    console.error('[pesos]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
