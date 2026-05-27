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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await obtenerAccessToken();

    // ── POST: registro de vacuna ──────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.modo === 'registro-vacuna') {
        // Leer hoja Vacunacion
        const urlVacH = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunacion!A1:A1')}`;
        const chkResp = await fetch(urlVacH, { headers: { Authorization: `Bearer ${token}` } });
        if (!chkResp.ok) return res.status(404).json({ error: 'Hoja Vacunacion no encontrada' });

        const newRow = [
          body.caravana         || '',
          body.boton            || '',
          body.categoria        || '',
          body.vacuna           || '',
          body.tipo_frecuencia  || 'anual',
          body.fecha_aplicacion || new Date().toLocaleDateString('es-AR'),
          body.fecha_proxima    || '',
          body.dias_alerta      || '30',
          'aplicada',
          body.lote             || '',
          body.veterinario      || '',
          body.operador         || '',
          body.observaciones    || '',
          new Date().toLocaleString('es-AR'),
          body.uuid_animal      || '',
        ];

        // Append row
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunacion!A:O')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const appendResp = await fetch(appendUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [newRow] }),
        });
        if (!appendResp.ok) throw new Error(`Sheets append error: ${appendResp.status}`);
        return res.status(200).json({ ok: true });
      }

      if (body.modo === 'registro-inseminacion') {
        // Verificar que exista la hoja
        const urlInsH = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Inseminaciones!A1:A1')}`;
        const chkIns = await fetch(urlInsH, { headers: { Authorization: `Bearer ${token}` } });
        if (!chkIns.ok) return res.status(404).json({ error: 'Hoja Inseminaciones no encontrada. Corre el Apps Script primero.' });

        // Calcular fecha de parto esperada
        const fechaIns = body.fecha_inseminacion ? new Date(body.fecha_inseminacion.split('/').reverse().join('-')) : new Date();
        const fechaParto = new Date(fechaIns.getTime() + 283 * 86400000);
        const fmt = d => d.toLocaleDateString('es-AR');

        const newRow = [
          body.caravana            || '',
          body.boton               || '',
          body.fecha_inseminacion  || fmt(new Date()),
          body.semen_toro          || '',
          body.metodo              || 'Inseminacion Artificial',
          fmt(fechaParto),           // fecha_parto_esperada calculada automaticamente
          '',                        // dias_para_parto (calculado en el cliente)
          '',                        // mes_gestacion (calculado en el cliente)
          body.estado              || 'en_servicio',
          body.fecha_tacto         || '',
          '',                        // fecha_parto_real
          body.operador            || '',
          body.observaciones       || '',
          new Date().toLocaleString('es-AR'),
        ];

        const appendUrlIns = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Inseminaciones!A:N')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const appendRespIns = await fetch(appendUrlIns, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [newRow] }),
        });
        if (!appendRespIns.ok) throw new Error(`Sheets append error inseminacion: ${appendRespIns.status}`);
        return res.status(200).json({ ok: true, fecha_parto_esperada: fmt(fechaParto) });
      }

      if (body.modo === 'registro-vacuna-masiva') {
        // body.animales = array de { caravana, boton, categoria }
        // body.vacuna, body.fecha_aplicacion, body.lote, body.veterinario, body.operador
        const animalesArr = Array.isArray(body.animales) ? body.animales : [];
        if (!animalesArr.length) return res.status(400).json({ error: 'Sin animales seleccionados' });
        if (!body.vacuna)        return res.status(400).json({ error: 'Vacuna requerida' });

        // Verificar hoja
        const urlVacH2 = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunacion!A1:A1')}`;
        const chkResp2 = await fetch(urlVacH2, { headers: { Authorization: `Bearer ${token}` } });
        if (!chkResp2.ok) return res.status(404).json({ error: 'Hoja Vacunacion no encontrada' });

        // Construir todas las filas
        const fechaApl = body.fecha_aplicacion || new Date().toLocaleDateString('es-AR');
        const ts       = new Date().toLocaleString('es-AR');
        const filas    = animalesArr.map(a => [
          a.caravana    || '',
          a.boton       || '',
          a.categoria   || a.tipo || '',
          body.vacuna,
          'anual',
          fechaApl,
          '',          // fecha_proxima
          '30',        // dias_alerta
          'aplicada',
          body.lote        || '',
          body.veterinario || '',
          body.operador    || '',
          body.observaciones || '',
          ts,
          a.uuid || '',
        ]);

        // Batch append — mandamos todas las filas de una
        const appendUrlB = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunacion!A:O')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const appendRespB = await fetch(appendUrlB, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: filas }),
        });
        if (!appendRespB.ok) throw new Error(`Sheets batch append error: ${appendRespB.status}`);
        return res.status(200).json({ ok: true, registrados: filas.length });
      }

      if (body.modo === 'registro-peso') {
        const { caravana: car, boton: btn, tipo, fecha, peso_kg, observaciones, operador } = body;
        if (!car && !btn) return res.status(400).json({ error: 'Se requiere caravana o boton' });
        if (!peso_kg || peso_kg <= 0 || peso_kg > 1500) return res.status(400).json({ error: 'peso_kg inv\u00e1lido' });
        const fechaAR = fecha || new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
        const tsAR    = new Date().toLocaleString('es-AR',  { timeZone: 'America/Argentina/Buenos_Aires' });
        const appendUrlP = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Pesos!A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
        const appendRespP = await fetch(appendUrlP, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[car||'', btn||'', tipo||'', fechaAR, peso_kg, observaciones||'', operador||'', tsAR]] }),
        });
        if (!appendRespP.ok) throw new Error(`Sheets pesos error: ${appendRespP.status}`);
        return res.status(200).json({ ok: true, peso_kg, fecha: fechaAR });
      }

      if (body.modo === 'registro-sangrado') {
        const {
          fecha, tipo_estudio, veterinario,
          total_rodeo, animales_muestreados,
          resultado, reactores, accion,
          proxima_fecha, comentarios, operador
        } = body;
        if (!fecha || !tipo_estudio || !resultado)
          return res.status(400).json({ error: 'fecha, tipo_estudio y resultado son obligatorios' });
        const tsAR = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        const appendUrlS = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Sangrado!A:L')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
        const appendRespS = await fetch(appendUrlS, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[
            fecha,
            tipo_estudio,
            veterinario    || '',
            total_rodeo    || '',
            animales_muestreados || '',
            resultado,
            reactores      || 0,
            accion         || 'Ninguna',
            proxima_fecha  || '',
            comentarios    || '',
            operador       || '',
            tsAR,
          ]] }),
        });
        if (!appendRespS.ok) throw new Error(`Sheets sangrado error: ${appendRespS.status}`);
        return res.status(200).json({ ok: true, fecha, resultado });
      }

      return res.status(400).json({ error: 'modo no reconocido' });
    }

    const { modo, boton, caravana } = req.query;

    // ── MODO: lista de vacunas desde hoja Vacunacion ────────────────────────
    if (modo === 'vacunas') {
      const urlVac  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Vacunacion!A:O')}`;
      const respVac = await fetch(urlVac, { headers: { Authorization: `Bearer ${token}` } });
      if (!respVac.ok) return res.status(200).json({ vacunas: [] });
      const filasVac = (await respVac.json()).values || [];
      if (filasVac.length <= 1) return res.status(200).json({ vacunas: [] });

      const headers = filasVac[0].map(h => (h || '').toLowerCase().trim());
      const getCol  = (fila, nombre) => fila[headers.indexOf(nombre)] || '';

      const vacunas = filasVac.slice(1).map(fila => ({
        caravana:         getCol(fila, 'caravana'),
        boton:            getCol(fila, 'boton'),
        categoria:        getCol(fila, 'categoria'),
        vacuna:           getCol(fila, 'vacuna'),
        tipo_frecuencia:  getCol(fila, 'tipo_frecuencia'),
        fecha_aplicacion: getCol(fila, 'fecha_aplicacion'),
        fecha_proxima:    getCol(fila, 'fecha_proxima'),
        estado:           getCol(fila, 'estado') || 'aplicada',
        dias_alerta:      getCol(fila, 'dias_alerta') || '30',
        lote:             getCol(fila, 'lote'),
        veterinario:      getCol(fila, 'veterinario'),
        operador:         getCol(fila, 'operador'),
        observaciones:    getCol(fila, 'observaciones'),
        timestamp:        getCol(fila, 'timestamp'),
      }));
      return res.status(200).json({ vacunas });
    }

    // ── MODO: sangrados desde hoja Sangrado ────────────────────────────────────────
    if (modo === 'sangrados') {
      const urlS  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Sangrado!A:L')}`;
      const respS = await fetch(urlS, { headers: { Authorization: `Bearer ${token}` } });
      if (!respS.ok) return res.status(200).json({ sangrados: [] });
      const filasS = (await respS.json()).values || [];
      if (filasS.length <= 1) return res.status(200).json({ sangrados: [] });
      const headersS = filasS[0].map(h => (h || '').toLowerCase().trim());
      const getS = (fila, col) => fila[headersS.indexOf(col)] || '';
      const sangrados = filasS.slice(1)
        .filter(f => f[0]) // debe tener fecha
        .map(fila => ({
          fecha:                getS(fila, 'fecha'),
          tipo_estudio:         getS(fila, 'tipo_estudio'),
          veterinario:          getS(fila, 'veterinario'),
          total_rodeo:          getS(fila, 'total_rodeo'),
          animales_muestreados: getS(fila, 'animales_muestreados'),
          resultado:            getS(fila, 'resultado'),
          reactores:            getS(fila, 'reactores') || '0',
          accion:               getS(fila, 'accion'),
          proxima_fecha:        getS(fila, 'proxima_fecha'),
          comentarios:          getS(fila, 'comentarios'),
          operador:             getS(fila, 'operador'),
          timestamp:            getS(fila, 'timestamp'),
        }))
        .reverse(); // más reciente primero
      return res.status(200).json({ sangrados });
    }

    // ── MODO: pesos de animales desde hoja Pesos ─────────────────────────────
    if (modo === 'pesos') {
      const urlP  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Pesos!A:H')}`;
      const respP = await fetch(urlP, { headers: { Authorization: `Bearer ${token}` } });
      if (!respP.ok) return res.status(200).json({ pesos: [] });
      const filasP = (await respP.json()).values || [];
      if (filasP.length <= 1) return res.status(200).json({ pesos: [], total: 0 });
      let todos = filasP.slice(1)
        .filter(f => f[0] || f[1])
        .map(f => ({
          caravana:      (f[0]||'').trim(),
          boton:         (f[1]||'').trim(),
          tipo:          (f[2]||'').trim(),
          fecha:         (f[3]||'').trim(),
          peso_kg:       parseFloat(f[4]) || 0,
          observaciones: (f[5]||'').trim(),
          operador:      (f[6]||'').trim(),
          timestamp:     (f[7]||'').trim(),
        }))
        .filter(r => r.peso_kg > 0);
      // Filtrar por animal si se pide
      const cLow = (caravana||'').trim().toLowerCase();
      const bLow = (boton||'').trim().toLowerCase();
      if (cLow || bLow) {
        todos = todos.filter(r =>
          (cLow && r.caravana.toLowerCase() === cLow) ||
          (bLow && r.boton.toLowerCase()    === bLow)
        );
      }
      todos.sort((a, b) => {
        const fa = a.fecha.split('/').reverse().join('-');
        const fb = b.fecha.split('/').reverse().join('-');
        return fb.localeCompare(fa);
      });
      const { limit } = req.query;
      if (limit) todos = todos.slice(0, parseInt(limit));
      return res.status(200).json({ pesos: todos, total: todos.length });
    }

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

    // ── MODO: lista de inseminaciones ──────────────────────────────────────────
    if (modo === 'inseminaciones') {
      const urlIns  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Inseminaciones!A:N')}`;
      const respIns = await fetch(urlIns, { headers: { Authorization: `Bearer ${token}` } });
      if (!respIns.ok) return res.status(200).json({ inseminaciones: [] });
      const filasIns = (await respIns.json()).values || [];
      if (filasIns.length <= 1) return res.status(200).json({ inseminaciones: [] });

      const hdrs = filasIns[0].map(h => (h || '').toLowerCase().trim());
      const gc   = (fila, nombre) => fila[hdrs.indexOf(nombre)] || '';

      const inseminaciones = filasIns.slice(1).map(fila => ({
        caravana:            gc(fila, 'caravana'),
        boton:               gc(fila, 'boton'),
        fecha_inseminacion:  gc(fila, 'fecha_inseminacion'),
        semen_toro:          gc(fila, 'semen_toro'),
        metodo:              gc(fila, 'metodo'),
        fecha_parto_esperada:gc(fila, 'fecha_parto_esperada'),
        estado:              gc(fila, 'estado') || 'en_servicio',
        fecha_tacto:         gc(fila, 'fecha_tacto'),
        fecha_parto_real:    gc(fila, 'fecha_parto_real'),
        operador:            gc(fila, 'operador'),
        observaciones:       gc(fila, 'observaciones'),
        timestamp:           gc(fila, 'timestamp'),
      }));
      return res.status(200).json({ inseminaciones });
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
      .map((fila, idx) => ({ fila, realIdx: idx }))       // preservar índice real de hoja
      .filter(({ fila }) => fila[0] || fila[1])
      .map(({ fila, realIdx }) => parsearFila(fila, realIdx));

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
