/**
 * api/tareas.js — Sistema de agenda/tareas
 *
 * GET  /api/tareas                       → todas las tareas
 * GET  /api/tareas?usuario=X             → tareas de un usuario
 * GET  /api/tareas?estado=Pendiente      → filtrar por estado
 * POST /api/tareas { modo:'nueva', ... } → crear tarea
 * POST /api/tareas { modo:'completar', id, comentario, usuario } → marcar completada
 * POST /api/tareas { modo:'eliminar', id } → eliminar (solo admin)
 *
 * Columnas hoja "Tareas" (A:J):
 *   A=ID  B=Fecha_creación  C=Título  D=Descripción
 *   E=Asignado_a  F=Asignado_por  G=Prioridad  H=Estado
 *   I=Fecha_completada  J=Comentario_completado
 */

const SHEET_ID              = process.env.GOOGLE_SHEET_ID || '1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-n8n@custom-unison-403623.iam.gserviceaccount.com';
const HOJA_TAREAS           = 'Tareas';

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
  const jwt = `${unsigned}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) throw new Error(`Auth error: ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// ─── Leer todas las filas de Tareas ──────────────────────────────────────────
async function leerTareas(token) {
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA_TAREAS + '!A:J')}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets error: ${resp.status}`);
  const filas = (await resp.json()).values || [];
  return filas.slice(1).map((f, idx) => ({
    _rowIndex:           idx + 2,
    id:                  f[0] || '',
    fecha_creacion:      f[1] || '',
    titulo:              f[2] || '',
    descripcion:         f[3] || '',
    asignado_a:          f[4] || '',
    asignado_por:        f[5] || '',
    prioridad:           f[6] || 'Media',
    estado:              f[7] || 'Pendiente',
    fecha_completada:    f[8] || '',
    comentario_completado: f[9] || '',
  })).filter(t => t.id); // solo filas con ID válido
}

// ─── UPDATE fila en Tareas ────────────────────────────────────────────────────
async function actualizarFila(token, rowIndex, fila) {
  const rango = `${HOJA_TAREAS}!A${rowIndex}:J${rowIndex}`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rango)}?valueInputOption=RAW`;
  const resp  = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: rango, values: [fila] }),
  });
  if (!resp.ok) throw new Error(`Update error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await obtenerAccessToken();

    // ── GET — listar tareas ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { usuario, estado } = req.query;
      let tareas = await leerTareas(token);

      if (usuario) tareas = tareas.filter(t =>
        t.asignado_a.toLowerCase() === usuario.toLowerCase()
      );
      if (estado) tareas = tareas.filter(t =>
        t.estado.toLowerCase() === estado.toLowerCase()
      );

      // Ordenar: Pendientes primero, luego por fecha desc
      tareas.sort((a, b) => {
        if (a.estado === 'Pendiente' && b.estado !== 'Pendiente') return -1;
        if (a.estado !== 'Pendiente' && b.estado === 'Pendiente') return  1;
        return (b.fecha_creacion || '').localeCompare(a.fecha_creacion || '');
      });

      return res.status(200).json({ tareas, total: tareas.length });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'Body inválido' }); }

    const hoy = new Date();
    const fechaHoy = `${hoy.getDate().toString().padStart(2,'0')}/${(hoy.getMonth()+1).toString().padStart(2,'0')}/${hoy.getFullYear()}`;
    const ahora    = `${hoy.getHours().toString().padStart(2,'0')}:${hoy.getMinutes().toString().padStart(2,'0')}`;

    // ── nueva tarea ──────────────────────────────────────────────────────────
    if (body.modo === 'nueva') {
      const { titulo, descripcion, asignado_a, asignado_por, prioridad } = body;
      if (!titulo || !asignado_a) return res.status(400).json({ error: 'Faltan titulo y asignado_a' });

      const id = `T${Date.now()}`;
      const fila = [
        id,
        `${fechaHoy} ${ahora}`,
        titulo,
        descripcion || '',
        asignado_a,
        asignado_por || '',
        prioridad || 'Media',
        'Pendiente',
        '',  // fecha_completada
        '',  // comentario_completado
      ];

      const url  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(HOJA_TAREAS)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [fila] }),
      });
      if (!resp.ok) throw new Error(`Append error: ${resp.status} ${await resp.text()}`);

      console.log('[tareas] ✅ Nueva:', titulo, '→', asignado_a);
      return res.status(200).json({ ok: true, id, tarea: { id, titulo, asignado_a, estado: 'Pendiente' } });
    }

    // ── completar tarea ──────────────────────────────────────────────────────
    if (body.modo === 'completar') {
      const { id, comentario, usuario } = body;
      if (!id) return res.status(400).json({ error: 'Falta id' });

      const tareas  = await leerTareas(token);
      const tarea   = tareas.find(t => t.id === id);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

      const filaActualizada = [
        tarea.id, tarea.fecha_creacion, tarea.titulo, tarea.descripcion,
        tarea.asignado_a, tarea.asignado_por, tarea.prioridad,
        'Completada',
        `${fechaHoy} ${ahora}`,
        comentario || '',
      ];

      await actualizarFila(token, tarea._rowIndex, filaActualizada);
      console.log('[tareas] ✅ Completada:', id, 'por', usuario);
      return res.status(200).json({ ok: true, id });
    }

    // ── eliminar tarea (limpia la fila) ──────────────────────────────────────
    if (body.modo === 'eliminar') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'Falta id' });

      const tareas = await leerTareas(token);
      const tarea  = tareas.find(t => t.id === id);
      if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

      await actualizarFila(token, tarea._rowIndex, ['','','','','','','','','','']);
      console.log('[tareas] 🗑️ Eliminada:', id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'modo desconocido' });

  } catch (err) {
    console.error('[tareas]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
