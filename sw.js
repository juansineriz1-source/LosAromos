/**
 * sw.js — Service Worker con Workbox
 *
 * Estrategias:
 *   - Assets estáticos (HTML, JS, CSS, iconos): Cache First → máxima velocidad offline.
 *   - API de sincronización: Background Sync → encola y reintenta automáticamente.
 *   - Google Sheets API: Network First con fallback a cache.
 *
 * Para compilar con Workbox CLI:
 *   npx workbox-cli generateSW workbox-config.js
 *
 * En modo desarrollo usamos importScripts desde CDN.
 */

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

const { core, precaching, routing, strategies, backgroundSync, expiration } = workbox;

// ─── Configuración base ─────────────────────────────────────────────────────
core.setCacheNameDetails({
  prefix: 'rodeo-pwa',
  suffix: 'v1',
});

core.skipWaiting();
core.clientsClaim();

// ─── Pre-caché de assets estáticos ─────────────────────────────────────────
// En producción, Workbox CLI inyecta aquí el manifest de revisiones.
// En desarrollo, listamos manualmente:
precaching.precacheAndRoute([
  { url: '/', revision: '1' },
  { url: '/index.html', revision: '1' },
  { url: '/css/estilos.css', revision: '1' },
  { url: '/js/app.js', revision: '1' },
  { url: '/js/db.js', revision: '1' },
  { url: '/js/bluetooth.js', revision: '1' },
  { url: '/js/sync.js', revision: '1' },
  { url: '/manifest.json', revision: '1' },
  // Dexie desde CDN (se cachea en primera visita)
]);

// ─── Estrategia Cache First para assets estáticos ──────────────────────────
// Cualquier request a JS, CSS, imágenes, fuentes: sirve desde caché primero.
routing.registerRoute(
  ({ request }) => ['script', 'style', 'image', 'font'].includes(request.destination),
  new strategies.CacheFirst({
    cacheName: 'rodeo-assets-v1',
    plugins: [
      new expiration.ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
      }),
    ],
  })
);

// ─── Background Sync para sincronización con servidor ──────────────────────
const SYNC_QUEUE_NAME = 'rodeo-sync-queue';

const bgSyncPlugin = new backgroundSync.BackgroundSyncPlugin(SYNC_QUEUE_NAME, {
  maxRetentionTime: 7 * 24 * 60, // retener por 7 días (en minutos)
  onSync: async ({ queue }) => {
    // Callback cuando se restablece la conexión
    let entry;
    const procesados = [];
    const fallidos = [];

    while ((entry = await queue.shiftRequest())) {
      try {
        const response = await fetch(entry.request.clone());

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        procesados.push(entry);

        // Notificar a todos los clientes abiertos
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            tipo: 'SYNC_EXITOSA',
            url: entry.request.url,
            timestamp: Date.now(),
          });
        });

      } catch (error) {
        console.error('[SW] Error al sincronizar:', error);
        fallidos.push(entry);

        // Re-encolar si falló
        await queue.unshiftRequest(entry);

        // Notificar el error
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            tipo: 'SYNC_ERROR',
            error: error.message,
            timestamp: Date.now(),
          });
        });

        // Si falló, no seguir procesando este ciclo
        break;
      }
    }

    // Notificar resumen
    if (procesados.length > 0) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        client.postMessage({
          tipo: 'SYNC_COMPLETADA',
          procesados: procesados.length,
          fallidos: fallidos.length,
          timestamp: Date.now(),
        });
      });
    }
  },
});

// ─── Interceptar requests POST a /api/sincronizar ──────────────────────────
routing.registerRoute(
  ({ url }) => url.pathname.startsWith('/api/sincronizar'),
  new strategies.NetworkOnly({
    plugins: [bgSyncPlugin],
  }),
  'POST'
);

// ─── Estrategia Network First para Google Sheets API ───────────────────────
// Si hay red, trae datos frescos del Sheet. Si no, sirve la última versión cacheada.
routing.registerRoute(
  ({ url }) => url.hostname === 'sheets.googleapis.com' || url.hostname === 'docs.google.com',
  new strategies.NetworkFirst({
    cacheName: 'rodeo-sheets-v1',
    networkTimeoutSeconds: 5, // si no responde en 5s, usa caché
    plugins: [
      new expiration.ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 24 * 60 * 60, // 1 día
      }),
    ],
  })
);

// ─── Manejo de mensajes desde la app ───────────────────────────────────────
self.addEventListener('message', async (event) => {
  if (event.data?.tipo === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.tipo === 'SYNC_MANUAL') {
    // La app puede triggerear sync manual cuando detecta que volvió la red
    try {
      await self.registration.sync.register(SYNC_QUEUE_NAME);
      event.source.postMessage({ tipo: 'SYNC_REGISTRADA' });
    } catch (e) {
      // Background Sync no disponible — la app manejará el retry
      event.source.postMessage({ tipo: 'SYNC_NO_DISPONIBLE', error: e.message });
    }
  }
});

// ─── Evento de sincronización periódica ────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_QUEUE_NAME) {
    console.log('[SW] Background Sync activado:', event.tag);
    // Workbox maneja la ejecución de la cola automáticamente
  }
});

// ─── Notificaciones push (preparado para futuro) ────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.titulo || 'RodeoApp', {
      body: data.mensaje,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: 'rodeo-notif',
      data: data.url,
    })
  );
});
