/**
 * js/fotos-animal.js — Fotos vinculadas a animales del rodeo
 *
 * Cada animal tiene un `animal_uuid` estable que no cambia aunque cambien
 * el botón o la caravana. Las fotos se guardan con este UUID como clave.
 *
 * Flujo:
 *  1. Al abrir el modal de edición, se genera (o recupera) el animal_uuid
 *  2. Las fotos se guardan localmente en IndexedDB (fotos_animal)
 *  3. Al sincronizar, se suben a MinIO bajo fotos-animal/<animal_uuid>/
 *  4. La URL pública queda en storage_url para acceso cross-device
 */

import db from './db.js';
import { DEVICE_ID, crearMetadatos } from './db.js';

const TZ = 'America/Argentina/Buenos_Aires';

// ─── Guardar animal_uuid en localStorage (índice local) ───────────────────────
// Clave: "auid_<boton>_<caravana>" → valor: uuid
// Permite recuperar el mismo UUID aunque se recargue la app
function claveMapa(boton, caravana) {
  return `auid_${(boton || '').trim()}_${(caravana || '').trim()}`;
}

export function obtenerOCrearAnimalUuid(boton, caravana) {
  const clave = claveMapa(boton, caravana);
  let uuid = localStorage.getItem(clave);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(clave, uuid);
  }
  return uuid;
}

// ─── Cargar fotos de un animal ────────────────────────────────────────────────
export async function cargarFotosAnimal(animal_uuid) {
  try {
    // Fotos locales (IndexedDB)
    const locales = await db.fotos_animal
      .where('animal_uuid').equals(animal_uuid)
      .sortBy('timestamp_local');

    // Fotos remotas (si hay URL guardada y no están locales)
    // Las remotas se mezclan con las locales por UUID
    return locales;
  } catch (err) {
    console.warn('[fotos-animal] Error cargando fotos locales:', err);
    return [];
  }
}

// ─── Agregar foto a un animal ─────────────────────────────────────────────────
export async function agregarFotoAnimal({ animal_uuid, boton, caravana, file, operador, onProgress }) {
  // Comprimir imagen
  const blob = await comprimirImagen(file, 1200, 0.82);

  const foto = {
    ...crearMetadatos(),
    animal_uuid,
    boton_al_guardar:    boton    || '',
    caravana_al_guardar: caravana || '',
    fecha:    new Date().toLocaleDateString('en-CA', { timeZone: TZ }),
    hora:     new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }),
    operador: operador || 'Operador',
    imagen_blob:  blob,
    imagen_tipo:  blob.type,
    imagen_size:  blob.size,
    storage_url:  null,
    storage_key:  null,
  };

  const id = await db.fotos_animal.add(foto);

  // Intentar subir inmediatamente si hay red
  if (navigator.onLine) {
    subirFotoAnimal(id, foto).catch(err =>
      console.warn('[fotos-animal] Error subiendo foto:', err)
    );
  }

  return { id, blob };
}

// ─── Subir foto a MinIO ───────────────────────────────────────────────────────
async function subirFotoAnimal(localId, foto) {
  const formData = new FormData();
  formData.append('file',         new File([foto.imagen_blob], `${foto.uuid}.jpg`, { type: foto.imagen_tipo }));
  formData.append('tipo',         'foto-animal');
  formData.append('animal_uuid',  foto.animal_uuid);
  formData.append('uuid',         foto.uuid);
  formData.append('operador',     foto.operador);

  const resp = await fetch('/api/subir-media', { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const { publicUrl, objectKey } = await resp.json();
  await db.fotos_animal.update(localId, {
    storage_url:  publicUrl,
    storage_key:  objectKey,
    sincronizado: 1,
  });
  return publicUrl;
}

// ─── Eliminar foto ────────────────────────────────────────────────────────────
export async function eliminarFotoAnimal(localId) {
  await db.fotos_animal.delete(localId);
}

// ─── Renderizar galería en el modal ──────────────────────────────────────────
export async function renderizarGaleriaAnimal(contenedorId, animal_uuid, boton, caravana, esAdmin) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;

  cont.innerHTML = '<p style="font-size:13px;color:#888;margin:8px 0">Cargando fotos...</p>';

  const fotos = await cargarFotosAnimal(animal_uuid);

  if (!fotos.length) {
    cont.innerHTML = '<p style="font-size:13px;color:#888;margin:8px 0">Sin fotos cargadas aún</p>';
  } else {
    cont.innerHTML = `
      <div class="fa-grid">
        ${fotos.map(f => {
          const src = f.storage_url || (f.imagen_blob ? URL.createObjectURL(f.imagen_blob) : null);
          if (!src) return '';
          return `
            <div class="fa-item" data-id="${f.id}">
              <img src="${src}" class="fa-thumb" loading="lazy" onclick="verFotoAnimalGrande('${src}')">
              <div class="fa-meta">${f.fecha} · ${f.hora}</div>
              ${esAdmin ? `<button class="fa-del" onclick="eliminarFotoUI(${f.id}, '${contenedorId}', '${animal_uuid}', '${boton}', '${caravana}', ${esAdmin})">🗑</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Botón agregar foto
  if (esAdmin) {
    const inputId = `fa-input-${contenedorId}`;
    cont.insertAdjacentHTML('beforeend', `
      <label class="btn btn-secundario fa-btn-agregar" style="margin-top:10px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        📷 Agregar foto
        <input type="file" id="${inputId}" accept="image/*" capture="environment" style="display:none" multiple>
      </label>
    `);

    document.getElementById(inputId).addEventListener('change', async (e) => {
      const archivos = Array.from(e.target.files);
      const operador = localStorage.getItem('rodeo_operador') || 'Admin';
      for (const file of archivos) {
        await agregarFotoAnimal({ animal_uuid, boton, caravana, file, operador });
      }
      e.target.value = '';
      await renderizarGaleriaAnimal(contenedorId, animal_uuid, boton, caravana, esAdmin);
    });
  }
}

// ─── Ver foto grande ──────────────────────────────────────────────────────────
window.verFotoAnimalGrande = function(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  overlay.innerHTML = `<img src="${src}" style="max-width:95vw;max-height:95vh;border-radius:12px;object-fit:contain;">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
};

window.eliminarFotoUI = async function(id, contenedorId, animal_uuid, boton, caravana, esAdmin) {
  if (!confirm('¿Eliminar esta foto?')) return;
  await eliminarFotoAnimal(id);
  await renderizarGaleriaAnimal(contenedorId, animal_uuid, boton, caravana, esAdmin);
};

// ─── Comprimir imagen ─────────────────────────────────────────────────────────
function comprimirImagen(file, maxPx, calidad) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    const urlObj = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(urlObj);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        const ratio = Math.min(maxPx / width, maxPx / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', calidad);
    };
    img.onerror = reject;
    img.src = urlObj;
  });
}
