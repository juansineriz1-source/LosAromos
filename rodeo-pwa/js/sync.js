/**
 * sync.js — Módulo de sincronización con Google Sheets
 *
 * ESTRATEGIA:
 * POST a /api/sincronizar (Vercel serverless function).
 * La función usa la service account de Google para escribir directo en Sheets.
 *
 * RESOLUCIÓN DE CONFLICTOS:
 * - Cada registro tiene `timestamp_local` y `device_id`.
 * - El servidor compara el timestamp del registro entrante con el existente.
 * - Gana el más reciente ("Last Write Wins" — adecuado para ganado).
 * - Si la diferencia es < 60 segundos → retorna { conflicto: true }.
 *
 * [Fix v2] Cap de MAX_INTENTOS=5 para evitar loop infinito en registros problemáticos.
 * [Fix v2] Conflictos se eliminan de sync_queue (no se reencolan).
 */

// ─── Configuración ─────────────────────────────────────────────────────────
const API_URL = '/api/sincronizar';
const MAX_INTENTOS = 5;

import db, { obtenerPendientesSync, marcarComoSincronizado } from './db.js';

// ─── Estado de conectividad ─────────────────────────────────────────────────
let estaOnline = navigator.onLine;
let syncEnCurso = false;
let observadoresConectividad = [];

/**
 * Inicializa el sistema de sincronización.
 */
export function inicializarSync(onCambioEstado) {
  if (onCambioEstado) {
    observadoresConectividad.push(onCambioEstado);
  }

  window.addEventListener('online', async () => {
    estaOnline = true;
    console.log('[Sync] Red disponible — iniciando sincronización...');
    _notificarEstado('online');
    await _esperar(2000);
    await sincronizarPendientes();
  });

  window.addEventListener('offline', () => {
    estaOnline = false;
    console.log('[Sync] Sin red — modo offline activado.');
    _notificarEstado('offline');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { tipo, procesados, error } = event.data;
      if (tipo === 'SYNC_COMPLETADA') {
        console.log(`[Sync] SW completó sync: ${procesados} registros`);
        _notificarEstado('sync_completada', { procesados });
      }
      if (tipo === 'SYNC_ERROR') {
        console.error('[Sync] SW reportó error:', error);
        _notificarEstado('sync_error', { error });
      }
    });
  }

  if (estaOnline) {
    setTimeout(() => sincronizarPendientes(), 3000);
  }
}

/**
 * Sincroniza todos los registros pendientes con el servidor.
 */
export async function sincronizarPendientes() {
  if (syncEnCurso || !estaOnline) {
    return { exitosos: 0, fallidos: 0 };
  }

  syncEnCurso = true;
  _notificarEstado('sincronizando');

  let exitosos = 0;
  let fallidos = 0;

  try {
    const pendientes = await obtenerPendientesSync();
    console.log(`[Sync] Sincronizando ${pendientes.length} registros pendientes...`);

    for (const item of pendientes) {
      // [Fix] Cap de reintentos: evita loop infinito con registros problemáticos
      if ((item.intentos || 0) >= MAX_INTENTOS) {
        console.warn(`[Sync] Descartando ${item.registro_uuid} tras ${item.intentos} intentos.`);
        await db.sync_queue.delete(item.id);
        fallidos++;
        continue;
      }

      try {
        const payload = JSON.parse(item.payload);
        const respuesta = await _enviarAlServidor(item.tabla, payload);

        if (respuesta.ok) {
          await marcarComoSincronizado(item.tabla, item.registro_uuid, item.id);
          exitosos++;
        } else if (respuesta.conflicto) {
          // [Fix] Marcar como conflicto y ELIMINAR de la cola (no reencolarlo)
          await db[item.tabla]
            .where('uuid').equals(item.registro_uuid)
            .modify({ sincronizado: 2 }); // 2 = conflicto
          await db.sync_queue.delete(item.id);
          fallidos++;
        }
      } catch (error) {
        const intentos = (item.intentos || 0) + 1;
        if (intentos >= MAX_INTENTOS) {
          await db.sync_queue.delete(item.id);
          console.warn(`[Sync] Registro ${item.registro_uuid} eliminado tras ${MAX_INTENTOS} reintentos.`);
        } else {
          await db.sync_queue.update(item.id, { intentos, ultimo_error: error.message });
        }
        fallidos++;
        console.error(`[Sync] Error en registro ${item.registro_uuid}:`, error);
      }
    }

    _notificarEstado('sync_completada', { exitosos, fallidos });

  } finally {
    syncEnCurso = false;
  }

  return { exitosos, fallidos };
}

/**
 * Envía un registro al servidor.
 */
async function _enviarAlServidor(tabla, payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabla,
      accion: payload.deleted ? 'DELETE' : 'UPSERT',
      datos: payload,
      clave_idempotencia: payload.uuid,
    }),
  });

  if (!response.ok) {
    throw new Error(`Servidor respondió ${response.status}`);
  }

  return response.json();
}

/**
 * Sincroniza metadata de media (audio/foto/video) ya subido a storage.
 */
export async function sincronizarMedia(tipo, registro) {
  if (!registro.storage_url) return;
  if (!estaOnline) return;

  const tablaMap = { recorrida: 'recorridas_meta', foto: 'fotos_meta', video: 'videos_meta' };
  const tabla = tablaMap[tipo];
  if (!tabla) return;

  const { audio_blob, imagen_blob, video_blob, ...meta } = registro;
  try {
    const resp = await fetch('/api/sincronizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabla, accion: 'UPSERT', datos: meta, clave_idempotencia: meta.uuid }),
    });
    if (resp.ok) console.log(`[Sync] Metadata ${tipo} sincronizada →`, registro.storage_url);
  } catch (e) {
    console.warn('[Sync] No se pudo sincronizar metadata media:', e.message);
  }
}

export async function solicitarSyncManual() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ tipo: 'SYNC_MANUAL' });
  }
  return sincronizarPendientes();
}

export function obtenerEstadoConectividad() {
  return { online: estaOnline, syncEnCurso };
}

function _notificarEstado(estado, datos = {}) {
  observadoresConectividad.forEach(fn => fn(estado, datos));
}

function _esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
