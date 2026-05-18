/**
 * push.js — Gestión de Web Push en el cliente
 *
 * 1. Pide permiso de notificaciones al usuario
 * 2. Obtiene la VAPID public key del servidor
 * 3. Suscribe el dispositivo al Push Service del navegador
 * 4. Registra la suscripción en /api/push-subscribe
 */

import { DEVICE_ID } from './db.js';

let vapidPublicKey = null;

// ─── Convertir VAPID key de base64url a Uint8Array ───────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// ─── Inicializar push ─────────────────────────────────────────────────────────
export async function inicializarPush() {
  // No disponible en algunos navegadores o sin HTTPS
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (!('PushManager' in window)) return;

  // Si ya tenemos permiso, suscribir silenciosamente
  if (Notification.permission === 'granted') {
    await suscribirSilencioso();
    return;
  }

  // Si está bloqueado, no hacer nada
  if (Notification.permission === 'denied') return;

  // Si el usuario postponed hace menos de 7 días, no molestar
  const postponed = localStorage.getItem('push_postponed');
  if (postponed && Date.now() < parseInt(postponed, 10)) return;

  // Si es 'default' → mostrar banner de invitación (no el popup del browser todavía)
  mostrarBannerNotificaciones();
}

// ─── Banner de invitación ─────────────────────────────────────────────────────
function mostrarBannerNotificaciones() {
  // Esperar 5 segundos antes de mostrar para no interrumpir el flujo inicial
  setTimeout(() => {
    const banner = document.createElement('div');
    banner.id = 'push-banner';
    banner.innerHTML = `
      <div class="push-banner-content">
        <span class="push-banner-icono">🔔</span>
        <div class="push-banner-texto">
          <strong>¿Activar notificaciones?</strong>
          <span>Recibís alertas cuando el campo registra actividad</span>
        </div>
        <div class="push-banner-btns">
          <button id="push-banner-si" class="push-banner-btn-si">Activar</button>
          <button id="push-banner-no" class="push-banner-btn-no">Ahora no</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('push-banner-si').addEventListener('click', async () => {
      banner.remove();
      await pedirPermiso();
    });
    document.getElementById('push-banner-no').addEventListener('click', () => {
      banner.remove();
      // No volver a preguntar por 7 días
      localStorage.setItem('push_postponed', Date.now() + 7 * 86400000);
    });
  }, 5000);
}

// ─── Pedir permiso explícito ──────────────────────────────────────────────────
async function pedirPermiso() {
  const resultado = await Notification.requestPermission();
  if (resultado === 'granted') {
    await suscribirSilencioso();
  }
}

// ─── Suscribir al Push Service ────────────────────────────────────────────────
async function suscribirSilencioso() {
  try {
    // Obtener VAPID public key del servidor
    if (!vapidPublicKey) {
      const r = await fetch('/api/push-subscribe');
      if (!r.ok) return;
      const d = await r.json();
      vapidPublicKey = d.vapidPublicKey;
    }

    if (!vapidPublicKey) return;

    const sw = await navigator.serviceWorker.ready;
    const suscripcion = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    const operador = localStorage.getItem('rodeo_operador') || 'Operador';

    // Guardar en el servidor
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: DEVICE_ID,
        operador,
        subscription: suscripcion.toJSON(),
      }),
    });

    console.log('[Push] Suscripción registrada OK');

  } catch (err) {
    // No es crítico — la app funciona igual sin push
    console.warn('[Push] No se pudo suscribir:', err.message);
  }
}
