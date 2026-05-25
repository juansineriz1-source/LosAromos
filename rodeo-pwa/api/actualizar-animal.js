/**
 * api/actualizar-animal.js
 *
 * POST /api/actualizar-animal
 *
 * NUEVO MODELO — registro maestro + historial separado:
 *
 * MODO NORMAL (editar animal):
 *   1. Busca la fila del animal en LosAromos por _rowIndex (o por Botón/Caravana)
 *   2. UPDATE esa fila con los nuevos valores (estado, tipo, color, etc.)
 *   3. INSERT en hoja "Historial" los campos que cambiaron
 *
 * MODO VACUNAR (body.modo = 'vacunar'):
 *   1. UPDATE la fila en LosAromos con las columnas de vacuna actualizadas
 *   2. INSERT en hoja "Vacunas" el registro de la aplicación
 *
 * Columnas LosAromos (A:R):
 *   A=Botón  B=Caravana  C=Estado  D=Tiene_caravana  E=Tiene_botón
 *   F=TIPO   G=Color     H=Fecha_última_act  I=Comentario  J=Usuario
 *   K=Fecha_vacuna  L=Aftosa  M=Brucelosis  N=Carbunclo  O=Mancha
 *   P=Queratoconjuntivitis  Q=Otras  R=Comentario_otras
 *
 * Columnas Historial (A:G):
 *   A=Fecha  B=Botón  C=Caravana  D=Campo  E=Valor_anterior  F=Valor_nuevo  G=Usuario
 *
 * Columnas Vacunas (A:F):
 *   A=Fecha  B=Botón  C=Caravana  D=Vacuna  E=Comentario  F=Usuario
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

const VACUNAS_COL_IDX = {
  // key → columna en la fila (0-indexed A=0)
  fecha_vacuna:             10,  // K
  vac_aftosa:               11,  // L
  vac_brucelosis:           12,  // M
  vac_carbunclo:            13,  // N
  vac_mancha:               14,  // O
  vac_queratoconjuntivitis: 15,  // P
  vac_otras:                16,  // Q
  vac_comentario_otras:     17,  // R
};

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

// ─── Buscar fila del animal en LosAromos ─────────────────────────────────────
async function encontrarFila(token, boton, caravana) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA + '!A:B')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets read error: ${resp.status}`);
  const filas = (await resp.json()).values || [];
  for (let i = 1; i < filas.length; i++) {
    const fb = (filas[i][0] || '').trim().toLowerCase();
    const fc = (filas[i][1] || '').trim().toLowerCase();
    if ((boton    && fb === boton.trim().toLowerCase())    ||
        (caravana && fc === caravana.trim().toLowerCase())) {
      return i + 1; // fila real 1-indexed
    }
  }
  return null;
}

// ─── UPDATE fila en LosAromos ────────────────────────────────────────────────
async function actualizarFilaMaestro(token, rowIndex, fila) {
  const rango = `${NOMBRE_HOJA}!A${rowIndex}:R${rowIndex}`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rango)}?valueInputOption=RAW`;
  const resp  = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: rango, values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Sheets update error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ─── INSERT en hoja Historial ─────────────────────────────────────────────────
async function appendHistorial(token, filas) {
  if (!filas.length) return;
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Historial')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: filas }),
  });
  if (!resp.ok) throw new Error(`Historial error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ─── INSERT en hoja Vacunas ──────────────────────────────────────────────────
async function appendVacuna(token, fila) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunas')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Vacunas error: ${resp.status} ${await resp.text()}`);
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

  const fechaHoy = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });

  try {
    const token = await obtenerAccessToken();

    // ════════════════════════════════════════════════════════
    // MODO VACUNAR
    // ════════════════════════════════════════════════════════
    if (body.modo === 'vacunar') {
      const { vacuna, fecha, comentario_otras, usuario, animal_actual: a } = body;
      if (!a || !vacuna)          return res.status(400).json({ error: 'Faltan campos: vacuna, animal_actual' });
      if (!VACUNAS_CAMPO[vacuna]) return res.status(400).json({ error: `Vacuna desconocida: ${vacuna}` });

      // Encontrar fila
      const rowIndex = a._rowIndex || await encontrarFila(token, a.boton, a.caravana);
      if (!rowIndex) return res.status(404).json({ error: 'Animal no encontrado en el maestro' });

      const fechaVac = fecha || fechaHoy;
      const campoKey = VACUNAS_CAMPO[vacuna];

      // Construir fila actualizada preservando todo el animal
      const fila = [
        a.boton || '', a.caravana || '', a.estado || '',
        a.tiene_caravana || '', a.tiene_boton || '',
        a.tipo || '', a.color || '', a.fecha || '',
        a.comentario || '', usuario || a.usuario || '',
        fechaVac,                                         // K — Fecha vacuna
        vacuna === 'aftosa'               ? fechaVac : (a.vac_aftosa               || ''),  // L
        vacuna === 'brucelosis'           ? fechaVac : (a.vac_brucelosis           || ''),  // M
        vacuna === 'carbunclo'            ? fechaVac : (a.vac_carbunclo            || ''),  // N
        vacuna === 'mancha'               ? fechaVac : (a.vac_mancha               || ''),  // O
        vacuna === 'queratoconjuntivitis' ? fechaVac : (a.vac_queratoconjuntivitis || ''),  // P
        vacuna === 'otras'                ? fechaVac : (a.vac_otras                || ''),  // Q
        vacuna === 'otras' && comentario_otras ? comentario_otras : (a.vac_comentario_otras || ''),  // R
      ];

      // 1. UPDATE maestro
      await actualizarFilaMaestro(token, rowIndex, fila);

      // 2. INSERT en hoja Vacunas (historial por vacuna)
      await appendVacuna(token, [
        fechaVac,
        a.boton    || '',
        a.caravana || '',
        vacuna,
        vacuna === 'otras' ? (comentario_otras || '') : '',
        usuario || a.usuario || '',
      ]);

      console.log('[vacunar] ✅', vacuna, 'para', a.boton || a.caravana, '→ row', rowIndex);
      return res.status(200).json({ ok: true, vacuna, fecha: fechaVac });
    }

    // ════════════════════════════════════════════════════════
    // MODO NUEVO — alta de animal (APPEND al maestro)
    // ════════════════════════════════════════════════════════
    if (body.modo === 'nuevo') {
      const { boton, caravana, estado, tipo, color, comentario, usuario, tiene_boton, tiene_caravana } = body;
      if (!boton && !caravana) return res.status(400).json({ error: 'Se requiere Botón o Caravana' });

      const filaAlta = [
        boton || '', caravana || '', estado || '',
        tiene_caravana || (caravana ? 'SI' : 'NO'),
        tiene_boton    || (boton    ? 'SI' : 'NO'),
        tipo || '', color || '', fechaHoy,
        comentario || '', usuario || '',
        '', '', '', '', '', '', '', '',  // K-R vacunas vacías
      ];

      const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(NOMBRE_HOJA)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [filaAlta] }),
      });
      if (!resp.ok) throw new Error(`Alta error: ${resp.status} ${await resp.text()}`);
      console.log('[nuevo-animal] ✅ Alta:', boton || caravana);
      return res.status(200).json({ ok: true, mensaje: `Animal ${boton || caravana} agregado` });
    }

    // ════════════════════════════════════════════════════════
    // MODO NORMAL — editar datos del animal
    // ════════════════════════════════════════════════════════
    const {
      boton, caravana, estado, tiene_caravana, tiene_boton,
      tipo, color, comentario, usuario,
      // Vacunas se preservan
      fecha_vacuna, vac_aftosa, vac_brucelosis, vac_carbunclo,
      vac_mancha, vac_queratoconjuntivitis, vac_otras, vac_comentario_otras,
      // Valores anteriores (para Historial)
      boton_viejo, caravana_vieja, estado_viejo, tipo_viejo,
      color_viejo, comentario_viejo,
      // Fila del maestro (enviada desde el frontend)
      row_index,
    } = body;

    if (!boton && !caravana) return res.status(400).json({ error: 'Se requiere Botón o Caravana' });

    // Encontrar fila (usar row_index del frontend si está disponible)
    const rowIndex = row_index || await encontrarFila(token, boton, caravana);
    if (!rowIndex) return res.status(404).json({ error: 'Animal no encontrado en el maestro' });

    // Fila actualizada en el maestro
    const nuevaFila = [
      boton           || '',   // A
      caravana        || '',   // B
      estado          || '',   // C
      tiene_caravana  || '',   // D
      tiene_boton     || '',   // E
      tipo            || '',   // F
      color           || '',   // G
      fechaHoy,               // H — fecha última actualización
      comentario      || '',   // I
      usuario         || '',   // J
      fecha_vacuna              || '',   // K — preservado
      vac_aftosa                || '',   // L
      vac_brucelosis            || '',   // M
      vac_carbunclo             || '',   // N
      vac_mancha                || '',   // O
      vac_queratoconjuntivitis  || '',   // P
      vac_otras                 || '',   // Q
      vac_comentario_otras      || '',   // R
    ];

    // Cambios para el historial (solo campos que realmente cambiaron)
    const CAMPOS_RASTREADOS = [
      { label: 'Estado',        nuevo: estado,   viejo: estado_viejo    },
      { label: 'TIPO',          nuevo: tipo,     viejo: tipo_viejo      },
      { label: 'Botón',         nuevo: boton,    viejo: boton_viejo     },
      { label: 'Caravana',      nuevo: caravana, viejo: caravana_vieja  },
      { label: 'Color',         nuevo: color,    viejo: color_viejo     },
      { label: 'Comentario',    nuevo: comentario, viejo: comentario_viejo },
    ];

    const filasHistorial = CAMPOS_RASTREADOS
      .filter(c => (c.viejo || '') !== (c.nuevo || '') && (c.viejo || c.nuevo))
      .map(c => [fechaHoy, boton || '', caravana || '', c.label, c.viejo || '', c.nuevo || '', usuario || '']);

    // 1. UPDATE maestro
    await actualizarFilaMaestro(token, rowIndex, nuevaFila);

    // 2. INSERT historial (solo si hubo cambios)
    if (filasHistorial.length) {
      await appendHistorial(token, filasHistorial);
    }

    console.log('[actualizar-animal] ✅ row', rowIndex, '→', boton || caravana, 'por', usuario,
                filasHistorial.length ? `| ${filasHistorial.length} cambios en Historial` : '| sin cambios');

    return res.status(200).json({
      ok: true,
      mensaje: `Animal ${boton || caravana} actualizado`,
      cambios: filasHistorial.length,
    });

  } catch (err) {
    console.error('[actualizar-animal]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
