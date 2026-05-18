/**
 * fotos.js — Captura y gestión de fotos del día
 *
 * Funcionalidades:
 *  - Selección desde galería (múltiples fotos)
 *  - Captura directa desde cámara trasera
 *  - Preview antes de guardar + posibilidad de eliminar
 *  - Almacenamiento local en IndexedDB como Blob
 *  - Subida background a MinIO via /api/upload-url
 *  - Historial con grilla de thumbnails
 *  - Ampliación de foto con tap
 */

import db, { crearMetadatos } from './db.js';
import { sincronizarMedia } from './sync.js';

// ─── Estado interno ───────────────────────────────────────────────────────────
let fotosEnCola = []; // Array de { file, objectUrl, id }

// ─── Init ─────────────────────────────────────────────────────────────────────
export function inicializarFotos(onToast) {
  const inputGaleria = document.getElementById('input-galeria');
  const inputCamara  = document.getElementById('input-camara');
  const btnGuardar   = document.getElementById('btn-foto-guardar');

  if (!inputGaleria) return;

  inputGaleria.addEventListener('change', e => procesarArchivos(e.target.files, onToast));
  inputCamara.addEventListener('change',  e => procesarArchivos(e.target.files, onToast));
  btnGuardar.addEventListener('click', () => guardarFotos(onToast));
}

// ─── Procesar archivos seleccionados ─────────────────────────────────────────
function procesarArchivos(files, onToast) {
  if (!files || files.length === 0) return;

  const MAX_FOTOS = 10;
  if (fotosEnCola.length + files.length > MAX_FOTOS) {
    onToast(`Máximo ${MAX_FOTOS} fotos por vez`, 'advertencia');
    return;
  }

  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    const id = Date.now() + Math.random();
    fotosEnCola.push({ file, objectUrl, id });
  });

  renderizarPreview();

  // Limpiar inputs para poder re-seleccionar las mismas fotos
  document.getElementById('input-galeria').value = '';
  document.getElementById('input-camara').value  = '';
}

// ─── Preview antes de guardar ─────────────────────────────────────────────────
function renderizarPreview() {
  const preview = document.getElementById('foto-preview');
  const grid    = document.getElementById('foto-preview-grid');

  if (fotosEnCola.length === 0) {
    preview.classList.add('oculto');
    grid.innerHTML = '';
    return;
  }

  preview.classList.remove('oculto');
  grid.innerHTML = fotosEnCola.map(f => `
    <div class="foto-thumb" data-id="${f.id}">
      <img src="${f.objectUrl}" alt="Foto">
      <button class="foto-thumb-del" onclick="eliminarFotoPreview(${f.id})">✕</button>
    </div>
  `).join('');
}

// Exponer para onclick en HTML generado
window.eliminarFotoPreview = function(id) {
  const idx = fotosEnCola.findIndex(f => f.id === id);
  if (idx !== -1) {
    URL.revokeObjectURL(fotosEnCola[idx].objectUrl);
    fotosEnCola.splice(idx, 1);
  }
  renderizarPreview();
};

// ─── Guardar fotos en IndexedDB ───────────────────────────────────────────────
async function guardarFotos(onToast) {
  if (fotosEnCola.length === 0) return;

  const btn = document.getElementById('btn-foto-guardar');
  btn.disabled = true;
  btn.textContent = `Guardando ${fotosEnCola.length} foto${fotosEnCola.length > 1 ? 's' : ''}...`;

  const operador = localStorage.getItem('rodeo_operador') || 'Operador';
  const guardadas = [];

  try {
    for (const { file, objectUrl } of fotosEnCola) {
      // Comprimir antes de guardar (max 1200px, calidad 0.82)
      const blob = await comprimirImagen(file, 1200, 0.82);

      const foto = {
        ...crearMetadatos(),
        fecha:      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
        hora:       new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }),
        operador,
        imagen_blob: blob,
        imagen_tipo: blob.type,
        imagen_size: blob.size,
        nombre_original: file.name,
        storage_url: null,
        storage_key: null,
      };

      const id = await db.fotos.add(foto);
      guardadas.push({ id, blob, operador });
      URL.revokeObjectURL(objectUrl);
    }

    fotosEnCola = [];
    renderizarPreview();
    onToast(`✓ ${guardadas.length} foto${guardadas.length > 1 ? 's' : ''} guardada${guardadas.length > 1 ? 's' : ''}`, 'exito');
    await cargarListaFotos();

    // Subir en background a MinIO
    guardadas.forEach(({ id, blob, operador }) =>
      subirFotoEnBackground(id, blob, operador, onToast)
    );

  } catch (err) {
    onToast(`✗ Error al guardar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar fotos';
  }
}

// ─── Comprimir imagen antes de guardar ────────────────────────────────────────
function comprimirImagen(file, maxPx = 1200, calidad = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Escalar si supera maxPx
      if (width > maxPx || height > maxPx) {
        const ratio = Math.min(maxPx / width, maxPx / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', calidad);
    };
    img.onerror = () => resolve(file); // fallback sin comprimir
    img.src = URL.createObjectURL(file);
  });
}

// ─── Subida a MinIO en background ─────────────────────────────────────────────
async function subirFotoEnBackground(fotoId, blob, operador, onToast) {
  if (!navigator.onLine) return;

  try {
    const resp = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'foto',
        contentType: blob.type || 'image/jpeg',
        operador,
      }),
    });

    if (!resp.ok) throw new Error(`upload-url ${resp.status}`);
    const { uploadUrl, publicUrl, objectKey } = await resp.json();

    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });

    if (!upload.ok) throw new Error(`MinIO PUT ${upload.status}`);

    const fotoActualizada = await db.fotos.get(fotoId);
    await db.fotos.update(fotoId, {
      storage_url: publicUrl,
      storage_key: objectKey,
    });

    // Sincronizar metadata para visibilidad cross-device
    if (fotoActualizada) {
      await sincronizarMedia('foto', { ...fotoActualizada, storage_url: publicUrl, storage_key: objectKey });
    }

    await cargarListaFotos();

  } catch (err) {
    console.warn('[Fotos] Subida background fallida:', err.message);
  }
}

// ─── Cargar historial de fotos ────────────────────────────────────────────────
export async function cargarListaFotos() {
  const lista = document.getElementById('lista-fotos');
  if (!lista) return;

  let fotos = [];
  try {
    fotos = await db.fotos.orderBy('timestamp_local').reverse().toArray();
  } catch {
    lista.innerHTML = '<p class="sin-historial">Sin fotos guardadas</p>';
    return;
  }

  if (!fotos.length) {
    lista.innerHTML = '<p class="sin-historial">Sin fotos guardadas</p>';
    return;
  }

  lista.innerHTML = fotos.map((f, i) => `
    <div class="foto-thumb" data-idx="${i}" onclick="abrirFotoModal(${i})">
      <img
        src="__BLOB__${f.id}"
        alt="Foto ${f.fecha}"
        loading="lazy"
        data-foto-id="${f.id}"
      >
      <div class="foto-thumb-badge">${f.storage_url ? '☁' : '○'}</div>
    </div>
  `).join('');

  // Cargar blobs en los img
  fotos.forEach(async (f, i) => {
    const img = lista.querySelector(`img[data-foto-id="${f.id}"]`);
    if (!img || !f.imagen_blob) return;
    img.src = URL.createObjectURL(f.imagen_blob);
  });

  // Guardar referencia para el modal
  window._fotosData = fotos;
}

// ─── Modal de foto ampliada ───────────────────────────────────────────────────
window.abrirFotoModal = async function(idx) {
  const fotos = window._fotosData || [];
  const f = fotos[idx];
  if (!f) return;

  // Crear modal dinámico
  const overlay = document.createElement('div');
  overlay.className = 'foto-modal-overlay';

  const url = f.imagen_blob ? URL.createObjectURL(f.imagen_blob) : f.storage_url;

  overlay.innerHTML = `
    <img class="foto-modal-img" src="${url}" alt="Foto">
    <button class="foto-modal-cerrar" id="foto-modal-btn-cerrar">✕</button>
    <div class="foto-info">${f.fecha} ${f.hora} · ${f.operador} ${f.storage_url ? '· ☁ guardada' : '· ○ local'}</div>
  `;

  document.body.appendChild(overlay);

  const cerrar = () => {
    if (f.imagen_blob) URL.revokeObjectURL(url);
    overlay.remove();
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(); });
  overlay.querySelector('#foto-modal-btn-cerrar').addEventListener('click', cerrar);
};
