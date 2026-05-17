/**
 * videos.js — Captura y gestión de videos del día
 *
 * Los videos se guardan en IndexedDB como Blob y se suben a MinIO en background.
 * NOTA: los videos pueden ser grandes (>50MB). Se guarda el blob localmente
 * y se sube directamente al NAS via presigned URL sin pasar por Vercel.
 */

import db, { crearMetadatos } from './db.js';

let videosEnCola = []; // Array de { file, objectUrl }

// ─── Init ─────────────────────────────────────────────────────────────────────
export function inicializarVideos(onToast) {
  const inputGaleria = document.getElementById('input-video-galeria');
  const inputCamara  = document.getElementById('input-video-camara');
  const btnGuardar   = document.getElementById('btn-video-guardar');

  if (!inputGaleria) return;

  inputGaleria.addEventListener('change', e => procesarVideos(e.target.files, onToast));
  inputCamara.addEventListener('change',  e => procesarVideos(e.target.files, onToast));
  btnGuardar.addEventListener('click', () => guardarVideos(onToast));
}

// ─── Procesar archivos de video ───────────────────────────────────────────────
function procesarVideos(files, onToast) {
  if (!files || files.length === 0) return;

  const MAX_MB = 500; // límite razonable por video
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('video/')) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      onToast(`Video muy grande (máx ${MAX_MB}MB): ${file.name}`, 'advertencia', 4000);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    videosEnCola.push({ file, objectUrl });
  });

  renderizarPreviewVideos();
  document.getElementById('input-video-galeria').value = '';
  document.getElementById('input-video-camara').value  = '';
}

// ─── Preview ──────────────────────────────────────────────────────────────────
function renderizarPreviewVideos() {
  const preview = document.getElementById('video-preview');
  const lista   = document.getElementById('video-preview-lista');

  if (videosEnCola.length === 0) {
    preview.classList.add('oculto');
    lista.innerHTML = '';
    return;
  }

  preview.classList.remove('oculto');
  lista.innerHTML = videosEnCola.map((v, i) => `
    <div class="video-item-preview">
      <video src="${v.objectUrl}" controls class="video-player" preload="metadata"></video>
      <div class="video-item-info">
        <span class="video-nombre">${v.file.name}</span>
        <span class="video-size">${(v.file.size / (1024*1024)).toFixed(1)} MB</span>
        <button class="foto-thumb-del" style="position:relative;top:0;right:0;" onclick="eliminarVideoPreview(${i})">✕</button>
      </div>
    </div>
  `).join('');
}

window.eliminarVideoPreview = function(i) {
  URL.revokeObjectURL(videosEnCola[i].objectUrl);
  videosEnCola.splice(i, 1);
  renderizarPreviewVideos();
};

// ─── Guardar en IndexedDB ─────────────────────────────────────────────────────
async function guardarVideos(onToast) {
  if (videosEnCola.length === 0) return;

  const btn = document.getElementById('btn-video-guardar');
  btn.disabled = true;
  btn.textContent = `Guardando ${videosEnCola.length} video${videosEnCola.length > 1 ? 's' : ''}...`;

  const operador = localStorage.getItem('rodeo_operador') || 'Operador';
  const guardados = [];

  try {
    for (const { file, objectUrl } of videosEnCola) {
      const video = {
        ...crearMetadatos(),
        fecha:           new Date().toISOString().split('T')[0],
        hora:            new Date().toTimeString().slice(0, 5),
        operador,
        video_blob:      file,  // guardamos el File directamente (Dexie soporta Blob/File)
        video_tipo:      file.type,
        video_size:      file.size,
        nombre_original: file.name,
        storage_url:     null,
        storage_key:     null,
      };

      const id = await db.videos.add(video);
      guardados.push({ id, file, operador });
      URL.revokeObjectURL(objectUrl);
    }

    videosEnCola = [];
    renderizarPreviewVideos();
    onToast(`✓ ${guardados.length} video${guardados.length > 1 ? 's' : ''} guardado${guardados.length > 1 ? 's' : ''}`, 'exito');
    await cargarListaVideos();

    // Subir en background a MinIO
    guardados.forEach(({ id, file, operador }) =>
      subirVideoEnBackground(id, file, operador, onToast)
    );

  } catch (err) {
    onToast(`✗ Error al guardar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar videos';
  }
}

// ─── Subida a MinIO en background ─────────────────────────────────────────────
async function subirVideoEnBackground(videoId, file, operador, onToast) {
  if (!navigator.onLine) return;

  try {
    const resp = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'video',
        contentType: file.type || 'video/mp4',
        operador,
      }),
    });

    if (!resp.ok) throw new Error(`upload-url ${resp.status}`);
    const { uploadUrl, publicUrl, objectKey } = await resp.json();

    onToast(`☁ Subiendo video (${(file.size / (1024*1024)).toFixed(0)}MB)...`, 'info', 3000);

    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'video/mp4' },
      body: file,
    });

    if (!upload.ok) throw new Error(`MinIO PUT ${upload.status}`);

    await db.videos.update(videoId, { storage_url: publicUrl, storage_key: objectKey });
    onToast('☁ Video subido al servidor', 'exito', 2500);
    await cargarListaVideos();

  } catch (err) {
    console.warn('[Videos] Subida background fallida:', err.message);
  }
}

// ─── Historial de videos ──────────────────────────────────────────────────────
export async function cargarListaVideos() {
  const lista = document.getElementById('lista-videos');
  if (!lista) return;

  let videos = [];
  try {
    videos = await db.videos.orderBy('timestamp_local').reverse().toArray();
  } catch {
    lista.innerHTML = '<p class="sin-historial">Sin videos guardados</p>';
    return;
  }

  if (!videos.length) {
    lista.innerHTML = '<p class="sin-historial">Sin videos guardados</p>';
    return;
  }

  lista.innerHTML = videos.map(v => `
    <div class="video-item">
      <div class="video-item-header">
        <span class="recorrida-fecha">${v.fecha} ${v.hora}</span>
        <span class="recorrida-duracion">${(v.video_size / (1024*1024)).toFixed(1)} MB ${v.storage_url ? '☁' : '○'}</span>
      </div>
      <div class="recorrida-operador">👤 ${v.operador} · ${v.nombre_original || 'video'}</div>
      <video
        class="video-player"
        controls
        preload="none"
        data-video-id="${v.id}"
      ></video>
    </div>
  `).join('');

  // Cargar blobs en los players
  videos.forEach(async v => {
    const player = lista.querySelector(`video[data-video-id="${v.id}"]`);
    if (!player) return;
    if (v.storage_url) {
      player.src = v.storage_url;
    } else if (v.video_blob) {
      player.src = URL.createObjectURL(v.video_blob);
    }
  });
}
