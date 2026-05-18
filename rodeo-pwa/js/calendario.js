/**
 * calendario.js — Feed de actividad diaria + Calendario con historial
 *
 * Sección "Actividad de hoy": muestra todo lo registrado hoy
 *   (novedades, registros de manga, recorridas, fotos, videos)
 *
 * Sección "Historial": calendario mensual navegable.
 *   - Días con actividad tienen un punto indicador
 *   - Al tocar un día → despliega todo lo que se registró ese día
 */

import db from './db.js';

// ─── Permisos ─────────────────────────────────────────────────────────────────
const ADMINS_CON_BORRADO = ['juan', 'ana', 'manuela', 'juanf', 'juan f'];
function esAdmin() {
  const op = (localStorage.getItem('rodeo_operador') || '').toLowerCase().trim();
  return ADMINS_CON_BORRADO.includes(op);
}

// ─── Estado del calendario ────────────────────────────────────────────────────
// Fecha en zona horaria de Argentina (UTC-3, sin DST)
function ahoraArgentina() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

let mesActual = ahoraArgentina();
mesActual.setDate(1); // primer día del mes

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── Init ─────────────────────────────────────────────────────────────────────
export async function inicializarCalendario() {
  document.getElementById('cal-prev')
    .addEventListener('click', () => navegarMes(-1));
  document.getElementById('cal-next')
    .addEventListener('click', () => navegarMes(+1));
  document.getElementById('cal-detalle-cerrar')
    .addEventListener('click', () => {
      document.getElementById('cal-detalle').classList.add('oculto');
    });

  await renderizarCalendario();
}

export async function cargarFeedHoy() {
  const hoy = fechaISO(new Date());
  const contenedor = document.getElementById('feed-hoy');
  if (!contenedor) return;

  // Cargar local + remoto en paralelo
  const [local, remoto] = await Promise.all([
    cargarActividadLocal(hoy),
    fetchActividadRemota(hoy),
  ]);

  // Mezclar y deduplicar por UUID
  const merged = mezclarDatos(local, remoto);

  const items = construirFeedItems(
    merged.novedades, merged.registros,
    merged.recorridas, merged.fotos, merged.videos
  );

  if (!items.length) {
    contenedor.innerHTML = '<p class="sin-historial">Sin actividad registrada hoy</p>';
    return;
  }

  const blobURLs = await crearBlobURLs(items);
  const puedeAdmin = esAdmin();
  contenedor.innerHTML = items.map(item => renderFeedItem(item, blobURLs, puedeAdmin)).join('');
}

// ─── Cargar actividad local (IndexedDB) ───────────────────────────────────
async function cargarActividadLocal(fecha) {
  const [novedades, registros, recorridas, fotos, videos] = await Promise.all([
    db.novedades.where('fecha').equals(fecha).toArray().catch(() => []),
    db.registros_manga.where('fecha').equals(fecha).toArray().catch(() => []),
    db.recorridas.where('fecha').equals(fecha).toArray().catch(() => []),
    db.fotos.where('fecha').equals(fecha).toArray().catch(() => []),
    db.videos.where('fecha').equals(fecha).toArray().catch(() => []),
  ]);
  return { novedades, registros, recorridas, fotos, videos };
}

// ─── Fetch actividad remota (Vercel → Sheets) ───────────────────────────────────
const VACIO_REMOTO = { registros: [], novedades: [], recorridas: [], fotos: [], videos: [] };

async function fetchActividadRemota(fecha) {
  try {
    const resp = await fetch(`/api/actividad?fecha=${fecha}`);
    if (!resp.ok) return VACIO_REMOTO;
    const data = await resp.json();
    // Garantizar que todos los arrays existan aunque el servidor devuelva versiones viejas
    return {
      registros:  data.registros  || [],
      novedades:  data.novedades  || [],
      recorridas: data.recorridas || [],
      fotos:      data.fotos      || [],
      videos:     data.videos     || [],
    };
  } catch {
    return VACIO_REMOTO;
  }
}

// ─── Mezclar local + remoto, deduplicar por UUID ─────────────────────────────
function mezclarDatos(local, remoto) {
  const dedup = (arr1, arr2) => {
    const vistos = new Set(arr1.map(x => x.uuid).filter(Boolean));
    const extras  = (arr2 || []).filter(x => x.uuid && !vistos.has(x.uuid));
    extras.forEach(x => { x._remoto = true; });
    return [...arr1, ...extras];
  };
  return {
    registros:  dedup(local.registros,  remoto.registros  || []),
    novedades:  dedup(local.novedades,  remoto.novedades  || []),
    // Media remota: solo tienen storage_url (sin blob local)
    recorridas: dedup(local.recorridas, remoto.recorridas || []),
    fotos:      dedup(local.fotos,      remoto.fotos      || []),
    videos:     dedup(local.videos,     remoto.videos     || []),
  };
}

// ─── Navegación de meses ──────────────────────────────────────────────────────
async function navegarMes(delta) {
  mesActual.setMonth(mesActual.getMonth() + delta);
  document.getElementById('cal-detalle').classList.add('oculto');
  await renderizarCalendario();
}

// ─── Renderizar grilla del calendario ────────────────────────────────────────
async function renderizarCalendario() {
  const año  = mesActual.getFullYear();
  const mes  = mesActual.getMonth();
  const hoy  = fechaISO(new Date());

  document.getElementById('cal-mes-label').textContent =
    `${MESES[mes]} ${año}`;

  // Obtener todos los días con actividad en este mes
  const diasConActividad = await obtenerDiasConActividad(año, mes);

  const primerDia   = new Date(año, mes, 1).getDay(); // 0=Dom
  const diasEnMes   = new Date(año, mes + 1, 0).getDate();
  const grid        = document.getElementById('cal-grid');

  let html = '';

  // Celdas vacías al inicio
  for (let i = 0; i < primerDia; i++) {
    html += '<div class="cal-celda cal-celda-vacia"></div>';
  }

  // Días del mes
  for (let d = 1; d <= diasEnMes; d++) {
    const fechaStr = `${año}-${String(mes + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const esHoy    = fechaStr === hoy;
    const tieneAct = diasConActividad.has(fechaStr);
    const esFuturo = fechaStr > hoy;

    html += `
      <div
        class="cal-celda ${esHoy ? 'cal-hoy' : ''} ${tieneAct ? 'cal-con-act' : ''} ${esFuturo ? 'cal-futuro' : ''}"
        data-fecha="${fechaStr}"
        onclick="abrirDiaCalendario('${fechaStr}')"
      >
        <span class="cal-num">${d}</span>
        ${tieneAct ? '<span class="cal-dot"></span>' : ''}
      </div>
    `;
  }

  grid.innerHTML = html;
}

// ─── Obtener set de fechas con actividad ─────────────────────────────────────
async function obtenerDiasConActividad(año, mes) {
  const primerDia = `${año}-${String(mes + 1).padStart(2,'0')}-01`;
  const ultimoDia = `${año}-${String(mes + 1).padStart(2,'0')}-31`;

  const tablas = ['novedades', 'registros_manga', 'recorridas', 'fotos', 'videos'];
  const dias   = new Set();

  await Promise.all(tablas.map(async tabla => {
    if (!db[tabla]) return;
    try {
      const items = await db[tabla]
        .where('fecha').between(primerDia, ultimoDia, true, true)
        .toArray();
      items.forEach(i => i.fecha && dias.add(i.fecha));
    } catch {}
  }));

  return dias;
}

// ─── Abrir detalle de un día ─────────────────────────────────────────────────
window.abrirDiaCalendario = async function(fechaStr) {
  // Highlight celda seleccionada
  document.querySelectorAll('.cal-celda.cal-sel').forEach(el =>
    el.classList.remove('cal-sel')
  );
  const celda = document.querySelector(`.cal-celda[data-fecha="${fechaStr}"]`);
  if (celda) celda.classList.add('cal-sel');

  const detalle   = document.getElementById('cal-detalle');
  const contenido = document.getElementById('cal-detalle-contenido');
  const label     = document.getElementById('cal-detalle-fecha');

  // Mostrar panel
  detalle.classList.remove('oculto');

  // Formatear fecha
  const [a, m, d] = fechaStr.split('-');
  label.textContent = `${parseInt(d)} de ${MESES[parseInt(m)-1]} ${a}`;
  contenido.innerHTML = '<p class="sin-historial">Cargando...</p>';

  const [local, remoto] = await Promise.all([
    cargarActividadLocal(fechaStr),
    fetchActividadRemota(fechaStr),
  ]);

  const merged = mezclarDatos(local, remoto);
  const items = construirFeedItems(
    merged.novedades, merged.registros,
    merged.recorridas, merged.fotos, merged.videos
  );

  if (!items.length) {
    contenido.innerHTML = '<p class="sin-historial">Sin actividad ese día</p>';
    return;
  }

  const blobURLs = await crearBlobURLs(items);
  const puedeAdmin = esAdmin();
  contenido.innerHTML = items.map(item => renderFeedItem(item, blobURLs, puedeAdmin)).join('');

  detalle.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ─── Construir lista unificada de items ──────────────────────────────────────
function construirFeedItems(novedades, registros, recorridas, fotos, videos) {
  const items = [];

  novedades.forEach(n => items.push({
    tipo: 'novedad', hora: n.hora || '', operador: n.operador,
    texto: n.texto, id: n.id,
  }));

  registros.forEach(r => items.push({
    tipo: 'registro', hora: r.hora || '', operador: r.operador,
    caravana: r.caravana, peso: r.peso_kg, estado: r.estado_sanitario,
    vacuna: r.vacuna_aplicada, id: r.id,
  }));

  recorridas.forEach(r => items.push({
    tipo: 'recorrida', hora: r.hora || '', operador: r.operador,
    duracion: r.duracion_seg, storage_url: r.storage_url, storage_key: r.storage_key,
    id: r.id, uuid: r.uuid, audio_blob: r.audio_blob,
  }));

  fotos.forEach(f => items.push({
    tipo: 'foto', hora: f.hora || '', operador: f.operador,
    imagen_blob: f.imagen_blob, storage_url: f.storage_url, storage_key: f.storage_key,
    id: f.id, uuid: f.uuid,
  }));

  videos.forEach(v => items.push({
    tipo: 'video', hora: v.hora || '', operador: v.operador,
    nombre: v.nombre_original, size: v.video_size,
    storage_url: v.storage_url, storage_key: v.storage_key,
    id: v.id, uuid: v.uuid,
  }));

  // Ordenar por hora
  return items.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
}

// ─── Crear object URLs para blobs (audio + fotos) ───────────────────────────
async function crearBlobURLs(items) {
  const urls = {}; // key: `tipo-id`
  await Promise.all(items.map(async item => {
    if (item.tipo === 'recorrida' && item.audio_blob) {
      try { urls[`recorrida-${item.id}`] = URL.createObjectURL(item.audio_blob); } catch {}
    }
    if (item.tipo === 'foto' && item.imagen_blob) {
      try { urls[`foto-${item.id}`] = URL.createObjectURL(item.imagen_blob); } catch {}
    }
  }));
  return urls;
}

// ─── Render de cada item del feed ────────────────────────────────────────────
function renderFeedItem(item, blobURLs = {}, puedeAdmin = false) {
  const hora = item.hora || '--:--';
  const op   = item.operador || 'Operador';

  const ICONOS = {
    novedad:   '📝', registro: '🐄', recorrida: '🎙', foto: '📷', video: '🎥',
  };
  const LABELS = {
    novedad:   'Novedad', registro: 'Pesaje en manga', recorrida: 'Recorrida de campo',
    foto: 'Foto', video: 'Video',
  };

  // Botón borrar solo para admins y solo si el archivo está en el servidor
  const puedesBorrar = puedeAdmin && item.storage_key &&
    ['recorrida','foto','video'].includes(item.tipo);
  const tablaMap = { recorrida: 'recorridas_meta', foto: 'fotos_meta', video: 'videos_meta' };
  const btnBorrar = puedesBorrar
    ? `<button
        class="feed-btn-borrar"
        onclick="borrarMediaFeed('${item.storage_key}','${tablaMap[item.tipo]}','${item.uuid || ''}','${item.id || ''}','${item.tipo}')"
        title="Borrar para todos"
       >🗑️</button>`
    : '';

  let detalle = '';
  if (item.tipo === 'novedad') {
    detalle = `<p class="feed-texto">${escHtml(item.texto || '')}</p>`;
  } else if (item.tipo === 'registro') {
    detalle = `
      <div class="feed-tags">
        ${item.caravana ? `<span class="feed-tag">🏷 ${item.caravana}</span>` : ''}
        ${item.peso    ? `<span class="feed-tag">⚖ ${item.peso} kg</span>` : ''}
        ${item.estado  ? `<span class="feed-tag">${item.estado}</span>` : ''}
        ${item.vacuna  ? `<span class="feed-tag">💉 ${item.vacuna}</span>` : ''}
      </div>`;
  } else if (item.tipo === 'recorrida') {
    const dur      = item.duracion ? formatearSeg(item.duracion) : '';
    const proxyUrl = item.storage_key ? `/api/media-proxy?key=${encodeURIComponent(item.storage_key)}` : '';
    const audioSrc = blobURLs[`recorrida-${item.id}`] || proxyUrl || item.storage_url || '';
    detalle = `
      <div class="feed-tags">
        ${dur ? `<span class="feed-tag">⏱ ${dur}</span>` : ''}
        ${item.storage_url ? `<span class="feed-tag feed-tag-ok">☁ Subida</span>` : `<span class="feed-tag">○ Local</span>`}
      </div>
      ${audioSrc
        ? `<audio controls class="feed-audio" src="${audioSrc}" preload="metadata"></audio>`
        : '<p class="sin-historial" style="font-size:12px">Audio no disponible</p>'
      }
    `;
  } else if (item.tipo === 'foto') {
    const fotoSrc = blobURLs[`foto-${item.id}`] || item.storage_url || '';
    detalle = fotoSrc
      ? `<img class="feed-foto-thumb" src="${fotoSrc}" alt="Foto" onclick="abrirLightbox('${fotoSrc}')">`
      : '<p class="sin-historial" style="font-size:12px">Foto no disponible</p>';
  } else if (item.tipo === 'video') {
    const videoKey = item.storage_key || '';
    const videoSrc = videoKey ? `/api/media-proxy?key=${encodeURIComponent(videoKey)}` : (item.storage_url || '');
    const sizeMB   = item.size ? `${(item.size/(1024*1024)).toFixed(1)} MB` : '';
    detalle = `
      <div class="feed-tags">
        ${sizeMB   ? `<span class="feed-tag">${sizeMB}</span>` : ''}
        ${item.storage_url ? `<span class="feed-tag feed-tag-ok">☁ Subido</span>` : `<span class="feed-tag">○ Local</span>`}
      </div>
      ${videoSrc
        ? `<video controls class="feed-video" preload="metadata" playsinline>
             <source src="${videoSrc}">
             Tu navegador no soporta la reproducción de video.
           </video>`
        : '<p class="sin-historial" style="font-size:12px">Video no disponible aún</p>'
      }`;
  }

  return `
    <div class="feed-item feed-${item.tipo}" data-id="${item.id}" data-tipo="${item.tipo}">
      <div class="feed-item-header">
        <span class="feed-icono">${ICONOS[item.tipo]}</span>
        <div class="feed-meta">
          <span class="feed-label">${LABELS[item.tipo]}${item._remoto ? ' <span class="feed-remoto">📡</span>' : ''}</span>
          <span class="feed-hora">${hora} · ${op}</span>
        </div>
        ${btnBorrar}
      </div>
      <div class="feed-detalle">${detalle}</div>
    </div>
  `;
}

// ─── Cargar blobs en elementos del feed (llamar después de insertar HTML) ────
export async function hidratarFeed(contenedor) {
  if (!contenedor) return;

  // Audios de recorridas
  contenedor.querySelectorAll('audio[data-recorrida-id]').forEach(async el => {
    const id = parseInt(el.dataset.recorridaId);
    const r  = await db.recorridas.get(id).catch(() => null);
    if (r?.audio_blob) el.src = URL.createObjectURL(r.audio_blob);
  });

  // Fotos
  contenedor.querySelectorAll('img[data-foto-id]').forEach(async el => {
    const id = parseInt(el.dataset.fotoId);
    const f  = await db.fotos.get(id).catch(() => null);
    if (f?.imagen_blob) el.src = URL.createObjectURL(f.imagen_blob);
    else if (f?.storage_url) el.src = f.storage_url;
  });
}

// ─── Borrar media (solo admins) ──────────────────────────────────────────────
window.borrarMediaFeed = async function(storageKey, tabla, uuid, localId, tipo) {
  if (!confirm('¿Borrar este archivo para todos? Esta acción no se puede deshacer.')) return;

  try {
    const resp = await fetch('/api/borrar-media', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ storage_key: storageKey, tabla, uuid }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || 'Error del servidor');

    // Borrar también de IndexedDB local
    const tablaLocal = { recorrida: 'recorridas', foto: 'fotos', video: 'videos' }[tipo];
    if (tablaLocal && localId && db[tablaLocal]) {
      await db[tablaLocal].delete(parseInt(localId)).catch(() => {});
    }

    // Refrescar el feed
    const feedHoy = document.getElementById('feed-hoy');
    if (feedHoy) await cargarFeedHoy();

    // Si hay un panel de detalle de calendario abierto, refrescarlo también
    const detalle = document.getElementById('cal-detalle');
    if (detalle && !detalle.classList.contains('oculto')) {
      const fechaLabel = document.getElementById('cal-detalle-fecha');
      // No podemos re-lanzar fácilmente sin la fecha; simplemente cerramos el panel
      detalle.classList.add('oculto');
    }

  } catch (err) {
    alert(`Error al borrar: ${err.message}`);
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fechaISO(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function formatearSeg(seg) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
