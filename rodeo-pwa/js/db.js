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
// Categorías con código y etiqueta (alineadas con el Rodeo Oficial)
export const CATEGORIAS = [
  { valor: 'V',      label: 'V — Vaca' },
  { valor: 'VQ',     label: 'VQ — Vaquillona' },
  { valor: 'V1',     label: 'V1 — Ternera 1er año' },
  { valor: 'V2',     label: 'V2 — Ternera 2do año' },
  { valor: 'V3',     label: 'V3 — Ternera 3er año' },
  { valor: 'V4',     label: 'V4 — Ternera 4to año' },
  { valor: 'V5',     label: 'V5 — Ternera 5to año' },
  { valor: 'V6',     label: 'V6 — Ternera 6to año' },
  { valor: 'TH',     label: 'TH — Ternera Hembra' },
  { valor: 'TM',     label: 'TM — Ternero Macho' },
  { valor: 'T',      label: 'T — Toro' },
  { valor: 'V CUT',  label: 'V CUT — Vaca a recría' },
];
export const COLORES = ['Negra', 'Colorada', 'Hosca', 'Bayo', 'Blanca', 'Sin registrar'];
export const ESTADOS_SANITARIOS = ['sano', 'vacunado', 'en_tratamiento', 'cuarentena', 'revisar'];
export const RAZAS = ['Aberdeen Angus', 'Hereford', 'Shorthorn', 'Brahman', 'Brangus', 'Criolla', 'Holstein', 'Otra'];
export const VACUNAS_COMUNES = [
  'Aftosa',
  'Brucelosis',
  'Carbunclo',
  'Mancha',
  'Queratoconjuntivitis',
  'Clostridiales',
  'IBR + DVB + Lepto',
  'Diarrea Neonatal',
  'Otra',
];

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
// Renombrada a RodeoDB_v4 para forzar recreación limpia en todos los clientes
const db = new Dexie('RodeoDB_v4');

// ─── Versión 1 (schema completo desde cero) ─────────────────────────────────
db.version(1).stores({
  animales: [
    '++id', 'uuid', 'caravana', 'categoria', 'raza', 'fecha_nacimiento',
    'sincronizado', 'timestamp_local', 'device_id', 'deleted',
  ].join(', '),

  registros_manga: [
    '++id', 'uuid', 'caravana', 'animal_uuid', 'peso_kg', 'estado_sanitario',
    'vacuna_aplicada', 'medicamento', 'dosis_ml', 'observaciones',
    'operador', 'fecha', 'hora', 'sincronizado', 'timestamp_local',
    'device_id', 'sync_intentos',
  ].join(', '),

  sync_queue: [
    '++id', 'tabla', 'registro_uuid', 'operacion', 'payload',
    'timestamp', 'intentos', 'ultimo_error',
  ].join(', '),

  config: '&clave, valor',

  novedades: [
    '++id', 'uuid', 'fecha', 'hora', 'texto', 'operador',
    'caravana', 'sincronizado', 'timestamp_local', 'device_id',
  ].join(', '),

  recorridas: [
    '++id', 'uuid', 'fecha', 'hora', 'duracion_seg', 'operador',
    'audio_blob', 'audio_tipo', 'audio_size',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),

  fotos: [
    '++id', 'uuid', 'fecha', 'hora', 'operador',
    'imagen_blob', 'imagen_tipo', 'imagen_size', 'nombre_original',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),

  videos: [
    '++id', 'uuid', 'fecha', 'hora', 'operador',
    'video_blob', 'video_tipo', 'video_size', 'nombre_original',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),
});

// Versión 2: agrega fotos por animal (vinculadas por animal_uuid estable)
db.version(2).stores({
  animales: [
    '++id', 'uuid', 'caravana', 'categoria', 'raza', 'fecha_nacimiento',
    'sincronizado', 'timestamp_local', 'device_id', 'deleted',
  ].join(', '),
  registros_manga: [
    '++id', 'uuid', 'caravana', 'animal_uuid', 'peso_kg', 'estado_sanitario',
    'vacuna_aplicada', 'medicamento', 'dosis_ml', 'observaciones',
    'operador', 'fecha', 'hora', 'sincronizado', 'timestamp_local',
    'device_id', 'sync_intentos',
  ].join(', '),
  sync_queue: [
    '++id', 'tabla', 'registro_uuid', 'operacion', 'payload',
    'timestamp', 'intentos', 'ultimo_error',
  ].join(', '),
  config: '&clave, valor',
  novedades: [
    '++id', 'uuid', 'fecha', 'hora', 'texto', 'operador',
    'caravana', 'sincronizado', 'timestamp_local', 'device_id',
  ].join(', '),
  recorridas: [
    '++id', 'uuid', 'fecha', 'hora', 'duracion_seg', 'operador',
    'audio_blob', 'audio_tipo', 'audio_size',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),
  fotos: [
    '++id', 'uuid', 'fecha', 'hora', 'operador',
    'imagen_blob', 'imagen_tipo', 'imagen_size', 'nombre_original',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),
  videos: [
    '++id', 'uuid', 'fecha', 'hora', 'operador',
    'video_blob', 'video_tipo', 'video_size', 'nombre_original',
    'storage_url', 'storage_key', 'timestamp_local', 'device_id',
  ].join(', '),
  /**
   * TABLA: fotos_animal
   * Fotos vinculadas a un animal por su animal_uuid (UUID estable).
   * Persiste aunque cambie el botón o la caravana.
   */
  fotos_animal: [
    '++id', 'uuid', 'animal_uuid',
    'boton_al_guardar', 'caravana_al_guardar',
    'fecha', 'hora', 'operador',
    'imagen_blob', 'imagen_tipo', 'imagen_size',
    'storage_url', 'storage_key',
    'timestamp_local', 'device_id', 'sincronizado',
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
  const [animales, registros, novedades] = await Promise.all([
    db.animales.where('sincronizado').equals(0).count(),
    db.registros_manga.where('sincronizado').equals(0).count(),
    db.novedades.where('sincronizado').equals(0).count().catch(() => 0),
  ]);
  return { animales, registros, novedades, total: animales + registros + novedades };
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
  const TZ = 'America/Argentina/Buenos_Aires';
  const novedad = {
    ...crearMetadatos(),
    fecha:    new Date().toLocaleDateString('en-CA', { timeZone: TZ }),
    hora:     new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }),
    caravana: datos.caravana || null,
    texto:    datos.texto,
    operador: datos.operador || '',
    sincronizado: 0,
  };
  await db.novedades.add(novedad);
  // Encolar para sincronizar a Google Sheets (cross-device)
  await encolarSync('novedades', novedad.uuid, 'INSERT', novedad);
  return novedad;
}

/**
 * Retorna todas las novedades ordenadas por más recientes primero.
 */
export async function obtenerNovedades() {
  return db.novedades.orderBy('timestamp_local').reverse().toArray();
}

export default db;
