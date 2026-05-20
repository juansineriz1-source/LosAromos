/**
 * api/usuarios.js — Lista de usuarios desde hoja "Usuarios"
 * GET /api/usuarios → [{ nombre, categoria }]
 * Columnas: A=Nombre, B=Categoria (Administrador | Operario)
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA           = 'Usuarios';

async function obtenerAccessToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const claim  = btoa(JSON.stringify({ iss: SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  try {
    const token = await obtenerAccessToken();
    const range = encodeURIComponent(`${NOMBRE_HOJA}!A2:B100`);
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Sheets error: ${await resp.text()}`);

    const data = await resp.json();
    const rows = data.values || [];

    // Filtrar filas vacías y normalizar
    const usuarios = rows
      .filter(r => r[0] && r[0].trim())
      .map(r => ({
        nombre:    r[0].trim(),
        categoria: (r[1] || 'Operario').trim(),   // Administrador | Operario
        rol:       (r[1] || 'Operario').trim().toLowerCase() === 'administrador' ? 'admin' : 'operario',
      }));

    res.status(200).json(usuarios);
  } catch (err) {
    console.error('[usuarios]', err);
    // Fallback a lista hardcodeada si la API falla
    res.status(200).json([
      { nombre: 'Juan',    categoria: 'Administrador', rol: 'admin' },
      { nombre: 'Juan F',  categoria: 'Administrador', rol: 'admin' },
      { nombre: 'Ana',     categoria: 'Administrador', rol: 'admin' },
      { nombre: 'Manuela', categoria: 'Administrador', rol: 'admin' },
      { nombre: 'Catalina',categoria: 'Administrador', rol: 'admin' },
      { nombre: 'Domingo', categoria: 'Operario',      rol: 'operario' },
      { nombre: 'Otro',    categoria: 'Operario',      rol: 'operario' },
    ]);
  }
}
