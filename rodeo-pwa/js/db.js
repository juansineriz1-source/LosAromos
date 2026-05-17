/**
 * db.js — Esquema de base de datos local con Dexie.js (IndexedDB)
 * 
 * ESTRATEGIA DE RESOLUCIÓN DE CONFLICTOS:
 * Usamos "Last Write Wins" con vector de timestamps por dispositivo.
 * Cada registro lleva: `timestamp_local` (cuando se guardó) y `device_id` (UUID del dispositivo).
 * Al sincronizar, el servidor compara timestamps y aplica el más reciente.
 * Para conflictos críticos (peso duplicado en mismo día), el servidor puede
 * devolver un flag `conflicto: true` que la app mostrará al usuario para resolución manual.
 * 
 * FLUJO:
 * 1. Guardado local inmediato (IndexedDB) — siempre funciona sin red.
 * 2. Background Sync encola el registro para envío al servidor.
 * 3. Al sincronizar, el servidor retorna el estado final y actualizamos `sincronizado: 1`.
 */

import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.mjs';

// ─── Constantes ────────────────────────────────────────────────────────────
export const CATEGORIAS = ['vaca', 'vaquillona', 'toro', 'ternero', 'ternera', 'novillito', 'novillo'];
export const ESTADOS_SANITARIOS = ['sano', 'vacunado', 'en_tratamiento', 'cuarentena', 'revisar'];
export const RAZAS = ['Aberdeen Angus', 'Hereford', 'Shorthorn', 'Brahman', 'Brangus', 'Criolla', 'Holstein', 'Otra'];

// ID único por dispositivo — persiste en localStorage
export const DEVICE_ID = (() => {
  const key = 'rodeo_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
})();

// ─── Definición de la base de datos ────────────────────────────────────────
const db = new Dexie('RodeoDB');

db.version(1).stores({
  /**
   * TABLA: animales
   * Registro maestro de cada animal identificado por su caravana.
   *
   * Índices:
   *   caravana     — ID único del animal (número de caravana física)
   *   categoria    — para filtrar por tipo de animal
   *   sincronizado — para encontrar rápido los pendientes de sync
   */
  animales: [
    '++id',          // PK autoincremental local
    'uuid',          // UUID generado en cliente (para idempotencia en el servidor)
    'caravana',      // ID único de la caravana (ej: "AR-1234-5678")
    'categoria',     // vaca | vaquillona | toro | ternero | etc.
    'raza',
    'fecha_nacimiento',
    'sincronizado',  // 0 = pendiente | 1 = sincronizado | 2 = conflicto
    'timestamp_local',
    'device_id',
    'deleted',       // soft delete: 0 | 1
  ].join(', '),

  /**
   * TABLA: registros_manga
   * Cada evento de pesaje/sanidad registrado en la manga.
   * Un animal puede tener MÚLTIPLES registros (historial).
   *
   * Índices:
   *   caravana     — para obtener el historial de un animal
   *   fecha        — para filtrar por jornada
   *   sincronizado — para cola de sync
   */
  registros_manga: [
    '++id',
    'uuid',          // UUID v4 — clave de idempotencia en el servidor
    'caravana',      // FK → animales.caravana
    'animal_uuid',   // FK → animales.uuid
    'peso_kg',       // número decimal
    'estado_sanitario',
    'vacuna_aplicada',
    'medicamento',
    'dosis_ml',
    'observaciones',
    'operador',      // nombre del peón/veterinario que cargó el dato
    'fecha',         // ISO date string: "2024-06-15"
    'hora',          // "HH:MM"
    'sincronizado',  // 0 | 1 | 2
    'timestamp_local',
    'device_id',
    'sync_intentos', // contador de reintentos fallidos
  ].join(', '),

  /**
   * TABLA: sync_queue
   * Cola de operaciones pendientes de enviar al servidor.
   * Workbox Background Sync la complementa, pero esta tabla
   * permite visibilidad y reintento manual desde la UI.
   */
  sync_queue: [
    '++id',
    'tabla',         // 'animales' | 'registros_manga'
    'registro_uuid', // UUID del registro a sincronizar
    'operacion',     // 'INSERT' | 'UPDATE' | 'DELETE'
    'payload',       // JSON stringificado
    'timestamp',
    'intentos',
    'ultimo_error',
  ].join(', '),

  /**
   * TABLA: config
   * Configuración local del dispositivo/operador.
   */
  config: '&clave, valor',

  /**
   * TABLA: novedades
   * Comentarios y novedades del día registradas por el operador.
   * Se muestran en la pestaña Inicio y se asocian opcionalmente a una caravana.
   */
  novedades: [
    '++id',
    'uuid',
    'fecha',
    'hora',
    'texto',
    'operador',
    'caravana',
    'sincronizado',
    'timestamp_local',
    'device_id',
  ].join(', '),

  /**
   * TABLA: recorridas
   * Grabaciones de audio de las recorridas diarias del campo.
   * El audio se guarda como Blob (IndexedDB soporta binarios nativos).
   * No se sincroniza con Sheets (demasiado voluminoso); queda local en el dispositivo.
   */
  recorridas: [
    '++id',
    'uuid',
    'fecha',
    'hora',
    'duracion_seg',
    'operador',
    'audio_blob',
    'audio_tipo',
    'audio_size',
    'storage_url',
    'storage_key',
    'timestamp_local',
    'device_id',
  ].join(', '),

  /**
   * TABLA: fotos
   * Fotos del día tomadas en el campo (cámara o galería).
   * Se comprimen en cliente antes de guardar y se sincronizan con MinIO en background.
   */
  fotos: [
    '++id',
    'uuid',
    'fecha',
    'hora',
    'operador',
    'imagen_blob',
    'imagen_tipo',
    'imagen_size',
    'nombre_original',
    'storage_url',
    'storage_key',
    'timestamp_local',
    'device_id',
  ].join(', '),
});

// ─── Funciones auxiliares ───────────────────────────────────────────────────

/**
 * Genera el payload base con metadatos de sincronización.
 */
export function crearMetadatos() {
  return {
    uuid: crypto.randomUUID(),
    timestamp_local: Date.now(),
    device_id: DEVICE_ID,
    sincronizado: 0,
    sync_intentos: 0,
    deleted: 0,
  };
}

/**
 * Guarda un animal nuevo o actualiza si ya existe la caravana.
 * Retorna el registro guardado.
 */
export async function guardarAnimal(datos) {
  const existente = await db.animales.where('caravana').equals(datos.caravana).first();

  if (existente) {
    // Actualizar: mantenemos UUID original para idempotencia
    const actualizado = {
      ...existente,
      ...datos,
      sincronizado: 0,           // marcar como pendiente de re-sync
      timestamp_local: Date.now(),
      device_id: DEVICE_ID,
    };
    await db.animales.put(actualizado);
    await encolarSync('animales', actualizado.uuid, 'UPDATE', actualizado);
    return actualizado;
  } else {
    const nuevo = { ...crearMetadatos(), ...datos };
    const id = await db.animales.add(nuevo);
    await encolarSync('animales', nuevo.uuid, 'INSERT', nuevo);
    return { ...nuevo, id };
  }
}

/**
 * Registra un evento de manga (pesaje + sanidad) para un animal.
 */
export async function guardarRegistroManga(datos) {
  const registro = {
    ...crearMetadatos(),
    fecha: new Date().toISOString().split('T')[0],
    hora: new Date().toTimeString().slice(0, 5),
    ...datos,
  };
  const id = await db.registros_manga.add(registro);
  await encolarSync('registros_manga', registro.uuid, 'INSERT', registro);
  return { ...registro, id };
}

/**
 * Agrega una operación a la cola de sincronización manual.
 */
async function encolarSync(tabla, registroUuid, operacion, payload) {
  await db.sync_queue.add({
    tabla,
    registro_uuid: registroUuid,
    operacion,
    payload: JSON.stringify(payload),
    timestamp: Date.now(),
    intentos: 0,
    ultimo_error: null,
  });
}

/**
 * Obtiene todos los registros pendientes de sincronización.
 */
export async function obtenerPendientesSync() {
  return db.sync_queue.orderBy('timestamp').toArray();
}

/**
 * Marca un registro como sincronizado exitosamente.
 */
export async function marcarComoSincronizado(tabla, uuid, queueId) {
  await db[tabla].where('uuid').equals(uuid).modify({ sincronizado: 1 });
  await db.sync_queue.delete(queueId);
}

/**
 * Cuenta los registros pendientes — para mostrar en UI.
 */
export async function contarPendientes() {
  const [animales, registros] = await Promise.all([
    db.animales.where('sincronizado').equals(0).count(),
    db.registros_manga.where('sincronizado').equals(0).count(),
  ]);
  return { animales, registros, total: animales + registros };
}

/**
 * Obtiene el historial de pesajes de un animal por su caravana.
 */
export async function historialAnimal(caravana) {
  return db.registros_manga
    .where('caravana').equals(caravana)
    .reverse()
    .sortBy('timestamp_local');
}

/**
 * Retorna todos los animales registrados (sin filtro).
 */
export async function obtenerTodosLosAnimales() {
  return db.animales.where('deleted').equals(0).toArray().catch(() => db.animales.toArray());
}

/**
 * Retorna todos los registros de manga.
 */
export async function obtenerTodosLosRegistros() {
  return db.registros_manga.toArray();
}

/**
 * Guarda una novedad / comentario del día.
 */
export async function guardarNovedad(datos) {
  const novedad = {
    ...crearMetadatos(),
    fecha: new Date().toISOString().split('T')[0],
    hora: new Date().toTimeString().slice(0, 5),
    caravana: datos.caravana || null,
    texto: datos.texto,
    operador: datos.operador || '',
  };
  await db.novedades.add(novedad);
  return novedad;
}

/**
 * Retorna todas las novedades ordenadas por más recientes primero.
 */
export async function obtenerNovedades() {
  return db.novedades.orderBy('timestamp_local').reverse().toArray();
}

export default db;
