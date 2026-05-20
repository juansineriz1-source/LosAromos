/**
 * api/animales.js — Lee el registro maestro + historial de vacunas + usuarios
 *
 * GET /api/animales                → lista todos los animales del maestro
 * GET /api/animales?modo=historial-vacunas&boton=X&caravana=Y
 *                                  → historial de vacunas de un animal (hoja Vacunas)
 * GET /api/animales?modo=usuarios  → lista de usuarios desde hoja Usuarios
 *
 * Columnas LosAromos (A:R):
 *   A=Botón  B=Caravana  C=Estado  D=Tiene_caravana  E=Tiene_botón
 *   F=TIPO   G=Color     H=Fecha_última_act  I=Comentario  J=Usuario
 *   K=Fecha_vacuna  L=Aftosa  M=Brucelosis  N=Carbunclo  O=Mancha
 *   P=Queratoconjuntivitis  Q=Otras  R=Comentario_otras
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const NOMBRE_HOJA           = 'LosAromos';

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

// ─── Parsear fila de LosAromos ────────────────────────────────────────────────
function parsearFila(fila, idx) {
  return {
    _rowIndex:                idx + 2,
    boton:                    fila[0]  || '',
    caravana:                 fila[1]  || '',
    estado:                   fila[2]  || '',
    tiene_caravana:           fila[3]  || '',
    tiene_boton:              fila[4]  || '',
    tipo:                     fila[5]  || '',
    color:                    fila[6]  || '',
    fecha:                    fila[7]  || '',
    comentario:               fila[8]  || '',
    usuario:                  fila[9]  || '',
    fecha_vacuna:             fila[10] || '',
    vac_aftosa:               fila[11] || '',
    vac_brucelosis:           fila[12] || '',
    vac_carbunclo:            fila[13] || '',
    vac_mancha:               fila[14] || '',
    vac_queratoconjuntivitis: fila[15] || '',
    vac_otras:                fila[16] || '',
    vac_comentario_otras:     fila[17] || '',
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
    const { modo, boton, caravana } = req.query;

    // ── MODO: historial de vacunas (fusionado desde historial-vacunas.js) ────
    if (modo === 'historial-vacunas') {
      if (!boton && !caravana) return res.status(400).json({ error: 'Se requiere boton o caravana' });

      const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunas!A:F')}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`Sheets error: ${resp.status}`);
      const filas = (await resp.json()).values || [];

      const historial = filas.slice(1)
        .filter(f => {
          const fb = (f[1] || '').trim().toLowerCase();
          const fc = (f[2] || '').trim().toLowerCase();
          return (boton    && fb === boton.trim().toLowerCase()) ||
                 (caravana && fc === caravana.trim().toLowerCase());
        })
        .map(f => ({
          fecha:     f[0] || '',
          vacuna:    f[3] || '',
          comentario: f[4] || '',
          usuario:   f[5] || '',
          campo_key: (() => {
            const MAP = { aftosa:'vac_aftosa', brucelosis:'vac_brucelosis', carbunclo:'vac_carbunclo',
                          mancha:'vac_mancha', queratoconjuntivitis:'vac_queratoconjuntivitis', otras:'vac_otras' };
            return MAP[(f[3]||'').toLowerCase().replace(/\s/g,'')] || (f[3]||'').toLowerCase();
          })(),
        }));

      const porVacuna = {};
      historial.forEach(h => {
        if (!porVacuna[h.campo_key]) porVacuna[h.campo_key] = [];
        porVacuna[h.campo_key].push({ fecha: h.fecha, comentario: h.comentario, usuario: h.usuario });
      });

      return res.status(200).json({ historial, porVacuna });
    }

    // ── MODO: lista de usuarios desde hoja Usuarios ───────────────────────────
    if (modo === 'usuarios') {
      const urlU  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Usuarios!A2:B100')}`;
      const respU = await fetch(urlU, { headers: { Authorization: `Bearer ${token}` } });
      if (!respU.ok) throw new Error(`Sheets error usuarios: ${respU.status}`);
      const rowsU = (await respU.json()).values || [];

      const usuarios = rowsU
        .filter(r => r[0] && r[0].trim())
        .map(r => ({
          nombre:    r[0].trim(),
          categoria: (r[1] || 'Operario').trim(),
          rol:       (r[1] || 'Operario').trim().toLowerCase() === 'administrador' ? 'admin' : 'operario',
        }));

      // Fallback si la hoja está vacía
      if (!usuarios.length) {
        return res.status(200).json([
          { nombre: 'Juan',     categoria: 'Administrador', rol: 'admin' },
          { nombre: 'Juan F',   categoria: 'Administrador', rol: 'admin' },
          { nombre: 'Ana',      categoria: 'Administrador', rol: 'admin' },
          { nombre: 'Manuela',  categoria: 'Administrador', rol: 'admin' },
          { nombre: 'Catalina', categoria: 'Administrador', rol: 'admin' },
          { nombre: 'Domingo',  categoria: 'Operario',      rol: 'operario' },
          { nombre: 'Otro',     categoria: 'Operario',      rol: 'operario' },
        ]);
      }
      return res.status(200).json(usuarios);
    }

    // ── MODO: lista de animales (default) ─────────────────────────────────────
    const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA + '!A:R')}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Sheets error: ${resp.status}`);
    const filas = (await resp.json()).values || [];

    if (!filas.length) return res.status(200).json({ animales: [], total: 0 });

    const animales = filas
      .slice(1)
      .filter(f => f[0] || f[1])
      .map((fila, idx) => parsearFila(fila, idx));

    animales.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return  1;
      return (a.boton || '').localeCompare(b.boton || '');
    });

    return res.status(200).json({ animales, total: animales.length });

  } catch (err) {
    console.error('[animales]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
