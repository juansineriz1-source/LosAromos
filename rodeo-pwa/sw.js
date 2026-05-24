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
  suffix: 'v20',
});

core.skipWaiting();
core.clientsClaim();

// ─── Pre-caché ───────────────────────────────────────────────────────────────
// Revisión 10 — Módulo de vacunación integrado
precaching.precacheAndRoute([
  { url: '/', revision: '10' },
  { url: '/index.html', revision: '10' },
  { url: '/css/estilos.css', revision: '10' },
  { url: '/js/app.js', revision: '11' },
  { url: '/js/vacunas.js', revision: '1' },
  { url: '/js/inseminaciones.js', revision: '1' },
  { url: '/js/db.js', revision: '9' },
  { url: '/js/bluetooth.js', revision: '9' },
  { url: '/js/sync.js', revision: '9' },
  { url: '/js/recorrida.js', revision: '9' },
  { url: '/js/fotos.js', revision: '9' },
  { url: '/js/videos.js', revision: '9' },
  { url: '/js/push.js', revision: '9' },
  { url: '/js/calendario.js', revision: '9' },
  { url: '/manifest.json', revision: '1' },
]);

// ─── Estrategia Cache First para assets estáticos ──────────────────────────
routing.registerRoute(
  ({ request }) => ['script', 'style', 'image', 'font'].includes(request.destination),
  new strategies.CacheFirst({
    cacheName: 'rodeo-assets-v4',
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

// ─── Mensajes desde el cliente ───────────────────────────────────────────────
self.addEventListener('message', (event) => {
  // Forzar update del SW desde la app
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Sync manual
  if (event.data === 'SYNC_NOW') {
    try {
      self.registration.sync.register('sync-manga');
      event.source.postMessage({ tipo: 'SYNC_REGISTRADA' });
    } catch (e) {
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

// ─── Push notifications ─────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch { return; }

  const options = {
    body: payload.cuerpo || payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-72.png',
    tag: 'rodeo-notif',
    renotify: true,
    vibrate: [200, 100, 200],
    data: payload.data || { url: '/' },
  };

  event.waitUntil(
    self.registration.showNotification(payload.titulo || 'RodeoApp 🐄', options)
  );
});

// Al tocar la notificación → abrir/enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
