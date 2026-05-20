/**
 * api/historial-vacunas.js
 *
 * GET /api/historial-vacunas?boton=XXX&caravana=YYY
 *
 * Lee TODAS las filas del sheet para un animal (sin deduplicar)
 * y devuelve el historial completo de vacunaciones.
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA           = 'LosAromos';

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
  const jwt = `${unsigned}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) throw new Error(`Auth error: ${await resp.text()}`);
  return (await resp.json()).access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { boton, caravana } = req.query;
  if (!boton && !caravana) return res.status(400).json({ error: 'Se requiere boton o caravana' });

  try {
    const token = await obtenerAccessToken();
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA + '!A:R')}`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Sheets error: ${resp.status}`);
    const filas = (await resp.json()).values || [];

    // Filtrar filas que pertenecen a este animal y tienen alguna vacuna
    const historial = filas.slice(1)
      .filter(f => {
        const fBoton    = (f[0] || '').trim().toLowerCase();
        const fCaravana = (f[1] || '').trim().toLowerCase();
        const coincide  = (boton    && fBoton    === boton.trim().toLowerCase()) ||
                          (caravana && fCaravana === caravana.trim().toLowerCase());
        const tieneVacuna = f[11] || f[12] || f[13] || f[14] || f[15] || f[16];
        return coincide && tieneVacuna;
      })
      .map(f => ({
        fecha_vacuna:             f[10] || '',
        vac_aftosa:               f[11] || '',
        vac_brucelosis:           f[12] || '',
        vac_carbunclo:            f[13] || '',
        vac_mancha:               f[14] || '',
        vac_queratoconjuntivitis: f[15] || '',
        vac_otras:                f[16] || '',
        vac_comentario_otras:     f[17] || '',
      }));

    return res.status(200).json({ historial });
  } catch (err) {
    console.error('[historial-vacunas]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
