/**
 * sync.js — Módulo de sincronización con Google Sheets y servidor
 *
 * ESTRATEGIA GOOGLE SHEETS (gratis + visual):
 * Usamos Google Apps Script como backend serverless:
 *   1. Creás un Google Sheet con las columnas necesarias.
 *   2. Publicás un Apps Script como Web App (URL pública).
 *   3. La app POST datos como JSON → el script los escribe en el Sheet.
 *
 * RESOLUCIÓN DE CONFLICTOS:
 * - Cada registro tiene `timestamp_local` y `device_id`.
 * - El servidor (Apps Script) compara el timestamp del registro entrante
 *   con el que ya existe en el Sheet para esa caravana+fecha.
 * - Gana el más reciente ("Last Write Wins" — adecuado para ganado).
 * - Si `timestamp_local` difiere en menos de 60 segundos → conflicto real
 *   → el servidor retorna { conflicto: true } y la app lo muestra al usuario.
 *
 * INSTRUCCIONES PARA CONFIGURAR:
 *   1. Ir a sheets.google.com → Nuevo → Extensiones → Apps Script
 *   2. Pegar el código de apps-script.js (incluido abajo como comentario)
 *   3. Publicar como Web App → "Cualquier usuario" → Copiar URL
 *   4. Pegar la URL en GOOGLE_SCRIPT_URL abajo
 */

// ─── Configuración ─────────────────────────────────────────────────────────
// 🔧 REEMPLAZAR con la URL de tu Google Apps Script publicado:
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/TU_ID_AQUI/exec';

// URL de simulación local para desarrollo:
const API_SIMULADA = '/api/sincronizar';

const USAR_GOOGLE_SHEETS = false; // Cambiar a true cuando configures el Script

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
  const url = USAR_GOOGLE_SHEETS ? GOOGLE_SCRIPT_URL : API_SIMULADA;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabla,
      accion: payload.deleted ? 'DELETE' : 'UPSERT',
      datos: payload,
      // El servidor usa (caravana + fecha) como clave de idempotencia
      clave_idempotencia: payload.uuid,
    }),
  });

  if (!response.ok) {
    throw new Error(`Servidor respondió ${response.status}`);
  }

  return response.json();
}

/**
 * Solicita sincronización inmediata al Service Worker.
 * Esto activa Background Sync si está registrado.
 */
export async function solicitarSyncManual() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ tipo: 'SYNC_MANUAL' });
  }
  // También intentamos sync directo
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
