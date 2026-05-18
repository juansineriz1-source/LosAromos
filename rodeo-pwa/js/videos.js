/**
 * videos.js — Captura y gestión de videos del día
 *
 * Los videos se guardan en IndexedDB como Blob y se suben a MinIO en background
 * via /api/subir-media (mismo proxy que audios y fotos, base64 JSON).
 *
 * Límite práctico: ~15 MB por video (Vercel body limit ~50 MB, base64 infla ~33%).
 * Videos más grandes muestran un aviso y no se suben al servidor.
 */

import db, { crearMetadatos } from './db.js';
import { sincronizarMedia } from './sync.js';

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

  const MAX_MB = 15; // límite por el body de Vercel (~50MB, base64 infla 33%)
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('video/')) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      onToast(`Video muy grande (máx ${MAX_MB} MB). Comprimilo antes de subir.`, 'advertencia', 5000);
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
        fecha:           new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
        hora:            new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }),
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

// ─── Subida a MinIO via proxy Vercel (mismo patrón que audios y fotos) ──────────
async function subirVideoEnBackground(videoId, file, operador, onToast) {
  if (!navigator.onLine) {
    console.log('[Videos] Sin red — video queda local hasta reconectar');
    return;
  }
  if (!file) {
    console.warn('[Videos] file es null — no se puede subir');
    return;
  }

  try {
    onToast(`☁ Subiendo video (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`, 'info', 4000);

    // Convertir blob/file → base64 para enviarlo como JSON al proxy
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]); // quitar "data:...;base64,"
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Subir via proxy Vercel → MinIO (server-side, sin CORS)
    const resp = await fetch('/api/subir-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo:     'video',
        base64,
        mimeType: file.type || 'video/mp4',
        operador,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`subir-media HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const result = await resp.json();
    if (!result.ok) throw new Error(result.error || 'Error desconocido en subir-media');
    const { publicUrl, objectKey } = result;

    // Actualizar registro local con URL y key
    const videoActualizado = await db.videos.get(videoId);
    await db.videos.update(videoId, { storage_url: publicUrl, storage_key: objectKey });

    // Sincronizar metadata para visibilidad cross-device
    if (videoActualizado) {
      await sincronizarMedia('video', { ...videoActualizado, storage_url: publicUrl, storage_key: objectKey });
    }

    onToast('☁ Video subido al servidor', 'exito', 2500);
    await cargarListaVideos();

  } catch (err) {
    console.error('[Videos] Subida background fallida:', err.message);
    onToast(`✗ Error al subir video: ${err.message}`, 'error');
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

  // Cargar src en los players: proxy > blob local > nada
  videos.forEach(async v => {
    const player = lista.querySelector(`video[data-video-id="${v.id}"]`);
    if (!player) return;

    if (v.storage_key) {
      // Reproducir via proxy Vercel → MinIO (evita CORS, soporta Range requests)
      player.src = `/api/media-proxy?key=${encodeURIComponent(v.storage_key)}`;
    } else if (v.video_blob) {
      // Blob local (grabado pero aún no subido)
      player.src = URL.createObjectURL(v.video_blob);
    }
    // Si no hay ni key ni blob, el player queda sin src (no reproduce, que es correcto)
  });
}
