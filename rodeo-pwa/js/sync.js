/**
 * sync.js — Módulo de sincronización con Google Sheets
 *
 * ESTRATEGIA:
 * POST a /api/sincronizar (Vercel serverless function).
 * La función usa la service account de Google para escribir directo en Sheets.
 * Sheet ID: 1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg
 *
 * RESOLUCIÓN DE CONFLICTOS:
 * - Cada registro tiene `timestamp_local` y `device_id`.
 * - El servidor compara el timestamp del registro entrante con el existente.
 * - Gana el más reciente ("Last Write Wins" — adecuado para ganado).
 * - Si la diferencia es < 60 segundos → retorna { conflicto: true }.
 */

// ─── Configuración ─────────────────────────────────────────────────────────
const API_URL = '/api/sincronizar';

import db, { obtenerPendientesSync, marcarComoSincronizado } from './db.js';

// ─── Estado de conectividad ─────────────────────────────────────────────────
let estaOnline = navigator.onLine;
let syncEnCurso = false;
let observadoresConectividad = [];

/**
 * Inicializa el sistema de sincronización.
 * Registra listeners de red y configura la sincronización automática.
 */
export function inicializarSync(onCambioEstado) {
  if (onCambioEstado) {
    observadoresConectividad.push(onCambioEstado);
  }

  // Escuchar cambios de conectividad
  window.addEventListener('online', async () => {
    estaOnline = true;
    console.log('[Sync] Red disponible — iniciando sincronización...');
    _notificarEstado('online');

    // Esperar 2 segundos para que la red estabilice antes de sincronizar
    await _esperar(2000);
    await sincronizarPendientes();
  });

  window.addEventListener('offline', () => {
    estaOnline = false;
    console.log('[Sync] Sin red — modo offline activado.');
    _notificarEstado('offline');
  });

  // Escuchar mensajes del Service Worker
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

  // Si arranca online, sincronizar inmediatamente
  if (estaOnline) {
    setTimeout(() => sincronizarPendientes(), 3000);
  }
}

/**
 * Sincroniza todos los registros pendientes con el servidor.
 * Llamado automáticamente al recuperar la red o manualmente desde la UI.
 *
 * @returns {Promise<{exitosos: number, fallidos: number}>}
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
      try {
        const payload = JSON.parse(item.payload);
        const respuesta = await _enviarAlServidor(item.tabla, payload);

        if (respuesta.ok) {
          await marcarComoSincronizado(item.tabla, item.registro_uuid, item.id);
          exitosos++;
        } else if (respuesta.conflicto) {
          // Marcar como conflicto para revisión manual
          await db[item.tabla]
            .where('uuid').equals(item.registro_uuid)
            .modify({ sincronizado: 2 }); // 2 = conflicto
          fallidos++;
        }
      } catch (error) {
        // Incrementar contador de intentos fallidos
        await db.sync_queue.update(item.id, {
          intentos: (item.intentos || 0) + 1,
          ultimo_error: error.message,
        });
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
 * Envía un registro al servidor (Google Sheets vía Apps Script o API propia).
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
 * Sincroniza la metadata de un archivo media (audio/foto/video) ya subido a MinIO.
 * Llama a /api/sincronizar con la tabla correspondiente (_meta) y solo campos
 * textuales (sin blob) para que otros dispositivos puedan acceder al archivo.
 *
 * @param {'recorrida'|'foto'|'video'} tipo
 * @param {Object} registro — el objeto de IndexedDB con storage_url ya seteado
 */
export async function sincronizarMedia(tipo, registro) {
  if (!registro.storage_url) return; // Solo si ya está en MinIO
  if (!estaOnline)           return;

  const tablaMap = { recorrida: 'recorridas_meta', foto: 'fotos_meta', video: 'videos_meta' };
  const tabla = tablaMap[tipo];
  if (!tabla) return;

  // Construir payload sin el blob (puede pesar cientos de MB)
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

/*
 * ═══════════════════════════════════════════════════════════════════════
 * CÓDIGO PARA GOOGLE APPS SCRIPT (pegar en el editor de Apps Script)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * function doPost(e) {
 *   const SHEET_ID = 'TU_GOOGLE_SHEET_ID';
 *   const ss = SpreadsheetApp.openById(SHEET_ID);
 *   const data = JSON.parse(e.postData.contents);
 *
 *   const hoja = ss.getSheetByName(data.tabla) || ss.insertSheet(data.tabla);
 *
 *   // Buscar si ya existe por UUID (idempotencia)
 *   const col_uuid = 1; // Columna A = UUID
 *   const valores = hoja.getDataRange().getValues();
 *   const fila_existente = valores.findIndex(row => row[0] === data.datos.uuid);
 *
 *   if (fila_existente > 0) {
 *     // Comparar timestamps para resolver conflicto
 *     const ts_existente = valores[fila_existente][col_ts]; // col timestamp
 *     if (data.datos.timestamp_local < ts_existente) {
 *       // El registro del servidor es más nuevo → conflicto
 *       return ContentService
 *         .createTextOutput(JSON.stringify({ ok: false, conflicto: true }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *     // Actualizar fila existente
 *     hoja.getRange(fila_existente + 1, 1, 1, cols.length).setValues([cols]);
 *   } else {
 *     // Insertar nueva fila
 *     hoja.appendRow(Object.values(data.datos));
 *   }
 *
 *   return ContentService
 *     .createTextOutput(JSON.stringify({ ok: true }))
 *     .setMimeType(ContentService.MimeType.JSON);
 * }
 *
 * function doGet(e) {
 *   // Health check y lectura de datos
 *   return ContentService
 *     .createTextOutput(JSON.stringify({ status: 'ok' }))
 *     .setMimeType(ContentService.MimeType.JSON);
 * }
 */
