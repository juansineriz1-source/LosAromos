/**
 * api/sincronizar.js — Vercel Serverless Function
 *
 * Recibe registros de la PWA RodeoApp y los escribe en Google Sheets.
 * Autenticación: Service Account bot-n8n@custom-unison-403623.iam.gserviceaccount.com
 * Sheet ID: 1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg
 *
 * Variables de entorno requeridas en Vercel:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — email de la service account
 *   GOOGLE_PRIVATE_KEY            — clave privada (con \n reales)
 *   GOOGLE_SHEET_ID               — ID del Google Sheet
 */

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';

// Columnas por tabla — orden de las columnas en el Sheet
const COLUMNAS = {
  animales: [
    'uuid', 'caravana', 'categoria', 'raza', 'fecha_nacimiento',
    'sincronizado', 'timestamp_local', 'device_id', 'deleted',
  ],
  registros_manga: [
    'uuid', 'caravana', 'animal_uuid', 'peso_kg', 'estado_sanitario',
    'vacuna_aplicada', 'medicamento', 'dosis_ml', 'observaciones',
    'operador', 'fecha', 'hora', 'sincronizado', 'timestamp_local',
    'device_id', 'sync_intentos',
  ],
};

// ─── JWT para service account ────────────────────────────────────────────────

async function obtenerAccessToken() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const email = SERVICE_ACCOUNT_EMAIL;
  const scope = 'https://www.googleapis.com/auth/spreadsheets';
  const now = Math.floor(Date.now() / 1000);

  // Header JWT
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  // Claim set
  const claim = btoa(JSON.stringify({
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsigned = `${header}.${claim}`;

  // Importar clave privada
  const pemBody = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${unsigned}.${signature}`;

  // Intercambiar JWT por access token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Error obteniendo token: ${err}`);
  }

  const { access_token } = await resp.json();
  return access_token;
}

// ─── Operaciones con Sheets API ──────────────────────────────────────────────

/**
 * Lee todos los valores de un rango en el Sheet.
 */
async function leerHoja(token, nombreHoja, rango = 'A:Z') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(nombreHoja + '!' + rango)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Error leyendo hoja: ${resp.status}`);
  const data = await resp.json();
  return data.values || [];
}

/**
 * Agrega una fila al final del Sheet.
 */
async function agregarFila(token, nombreHoja, fila) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(nombreHoja)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Error agregando fila: ${resp.status}`);
  return resp.json();
}

/**
 * Actualiza una fila existente por número de fila (1-indexed).
 */
async function actualizarFila(token, nombreHoja, numeroFila, fila) {
  const rango = `${nombreHoja}!A${numeroFila}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rango)}?valueInputOption=RAW`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Error actualizando fila: ${resp.status}`);
  return resp.json();
}

/**
 * Asegura que el Sheet tenga una hoja con el nombre dado y cabeceras.
 */
async function asegurarHoja(token, nombreHoja, columnas) {
  // Intentar leer — si tiene datos, ya existe
  const valores = await leerHoja(token, nombreHoja, 'A1:Z1');
  if (valores.length === 0) {
    // Insertar cabeceras
    await agregarFila(token, nombreHoja, columnas);
  }
}

// ─── Lógica de UPSERT con idempotencia ──────────────────────────────────────

/**
 * Escribe un registro en el Sheet con idempotencia por UUID.
 * Implementa Last Write Wins: si el timestamp entrante es más nuevo, sobrescribe.
 */
async function upsertRegistro(token, tabla, datos) {
  const columnas = COLUMNAS[tabla];
  if (!columnas) {
    throw new Error(`Tabla desconocida: ${tabla}`);
  }

  await asegurarHoja(token, tabla, columnas);

  const valores = await leerHoja(token, tabla);

  // Fila 1 = cabeceras, filas 2+ = datos (índice 1+ en el array)
  const cabeceras = valores[0] || columnas;
  const colUUID = cabeceras.indexOf('uuid');
  const colTimestamp = cabeceras.indexOf('timestamp_local');

  // Buscar fila existente por UUID
  let filaExistente = -1;
  let timestampExistente = 0;

  for (let i = 1; i < valores.length; i++) {
    if (valores[i][colUUID] === datos.uuid) {
      filaExistente = i + 1; // número de fila real en el Sheet (1-indexed)
      timestampExistente = parseInt(valores[i][colTimestamp] || '0', 10);
      break;
    }
  }

  // Construir array de valores en el orden de las columnas
  const fila = columnas.map(col => {
    const val = datos[col];
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });

  if (filaExistente > 0) {
    // Registro existente: aplicar Last Write Wins
    const diferenciaMs = Math.abs(datos.timestamp_local - timestampExistente);

    if (diferenciaMs < 60000 && datos.timestamp_local <= timestampExistente) {
      // Diferencia < 60s y el entrante NO es más reciente → conflicto real
      return { ok: false, conflicto: true };
    }

    if (datos.timestamp_local > timestampExistente) {
      // Entrante más nuevo → sobrescribir
      await actualizarFila(token, tabla, filaExistente, fila);
    }
    // Si el existente es más nuevo, ignoramos el entrante sin conflicto

  } else {
    // Nuevo registro → insertar
    await agregarFila(token, tabla, fila);
  }

  return { ok: true };
}

// ─── Handler principal ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS para la PWA
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', servicio: 'RodeoApp Sync API' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const { tabla, datos, accion } = req.body;

    if (!tabla || !datos) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: tabla, datos' });
    }

    if (!COLUMNAS[tabla]) {
      return res.status(400).json({ ok: false, error: `Tabla no soportada: ${tabla}` });
    }

    const token = await obtenerAccessToken();
    const resultado = await upsertRegistro(token, tabla, datos);

    // ── Notificación push en background (no bloquea la respuesta) ──────────
    if (resultado.ok) {
      const titulo = tabla === 'registros_manga'
        ? `🐄 ${datos.operador || 'Operador'} registró un pesaje`
        : `📋 ${datos.operador || 'Operador'} actualizó un animal`;

      const cuerpo = tabla === 'registros_manga'
        ? `Caravana ${datos.caravana} · ${datos.peso_kg ? datos.peso_kg + ' kg' : ''} · ${datos.estado_sanitario || ''}`
        : `Caravana ${datos.caravana}`;

      // Fire & forget — no esperamos la respuesta del push
      fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['host']}/api/push-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_device_id: datos.device_id || '',
          titulo,
          cuerpo,
          data: { tabla, caravana: datos.caravana },
        }),
      }).catch(e => console.warn('[push trigger]', e.message));
    }

    return res.status(200).json(resultado);

  } catch (error) {
    console.error('[API sincronizar]', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
