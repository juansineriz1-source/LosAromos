/**
 * app.js — Controlador principal de la aplicación RodeoApp
 *
 * Orquesta: UI ↔ Base de Datos ↔ Bluetooth ↔ Sincronización
 */

import { guardarAnimal, guardarRegistroManga, contarPendientes, historialAnimal, CATEGORIAS, ESTADOS_SANITARIOS, RAZAS } from './db.js';
import { conectarBaston, desconectarBaston, estadoBluetooth, simularLectura, bluetoothDisponible } from './bluetooth.js';
import { inicializarSync, sincronizarPendientes, obtenerEstadoConectividad } from './sync.js';

// ─── Estado de la UI ────────────────────────────────────────────────────────
const estado = {
  caravanaActual: null,
  bluetoothConectado: false,
  operador: localStorage.getItem('rodeo_operador') || '',
};

// ─── Selectores del DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Inicialización ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await registrarServiceWorker();
  inicializarSync(manejarCambioConectividad);
  poblarSelects();
  configurarEventos();
  await actualizarContadorPendientes();

  // Operador inicial
  if (!estado.operador) {
    const nombre = prompt('¿Nombre del operador?') || 'Operador';
    estado.operador = nombre;
    localStorage.setItem('rodeo_operador', nombre);
  }
  $('operador-nombre').textContent = estado.operador;
});

// ─── Service Worker ─────────────────────────────────────────────────────────
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('[App] SW registrado:', reg.scope);

    // Notificar actualización disponible
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          mostrarToast('Nueva versión disponible. Recargá la página.', 'info', 0);
        }
      });
    });
  } catch (e) {
    console.error('[App] Error al registrar SW:', e);
  }
}

// ─── Eventos UI ─────────────────────────────────────────────────────────────
function configurarEventos() {
  // Botón conectar bastón
  $('btn-bluetooth').addEventListener('click', async () => {
    if (estado.bluetoothConectado) {
      await desconectarBaston();
      estado.bluetoothConectado = false;
      actualizarUIBluetooth(false);
    } else {
      await conectarBaston({
        onCaravana: caravanaRecibida,
        onEstado: manejarEstadoBluetooth,
      });
    }
  });

  // Botón simular lectura (para pruebas)
  $('btn-simular').addEventListener('click', () => simularLectura());

  // Botón guardar registro
  $('btn-guardar').addEventListener('click', guardarRegistro);

  // Botón sync manual
  $('btn-sync').addEventListener('click', async () => {
    $('btn-sync').disabled = true;
    $('btn-sync').textContent = 'Sincronizando...';
    const resultado = await sincronizarPendientes();
    mostrarToast(`Sync: ${resultado.exitosos} enviados, ${resultado.fallidos} fallidos`, resultado.fallidos > 0 ? 'advertencia' : 'exito');
    await actualizarContadorPendientes();
    $('btn-sync').disabled = false;
    $('btn-sync').textContent = '↑ Sincronizar';
  });

  // Caravana manual (teclado)
  $('input-caravana').addEventListener('change', (e) => {
    const val = e.target.value.trim().toUpperCase();
    if (val) caravanaRecibida(val);
  });

  // Limpiar formulario
  $('btn-limpiar').addEventListener('click', limpiarFormulario);
}

// ─── Bluetooth ───────────────────────────────────────────────────────────────
function caravanaRecibida(caravana) {
  estado.caravanaActual = caravana;
  $('input-caravana').value = caravana;

  // Vibrar para confirmar lectura (háptica)
  if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);

  // Flash visual en el input
  $('input-caravana').classList.add('flash-lectura');
  setTimeout(() => $('input-caravana').classList.remove('flash-lectura'), 600);

  // Enfocar el campo de peso para carga rápida
  $('input-peso').focus();

  mostrarToast(`✓ Caravana ${caravana} leída`, 'exito', 2000);
  cargarHistorialAnimal(caravana);
}

function manejarEstadoBluetooth(estadoBT, mensaje) {
  const mapa = {
    buscando: { texto: 'Buscando...', clase: 'buscando' },
    conectando: { texto: 'Conectando...', clase: 'buscando' },
    conectado: { texto: `🔵 ${mensaje}`, clase: 'conectado' },
    desconectado: { texto: 'Desconectado', clase: 'desconectado' },
    cancelado: { texto: 'Cancelado', clase: 'desconectado' },
    reconectando: { texto: 'Reconectando...', clase: 'buscando' },
    error: { texto: `Error: ${mensaje}`, clase: 'error' },
  };

  const ui = mapa[estadoBT] || { texto: estadoBT, clase: '' };
  $('estado-bt').textContent = ui.texto;
  $('estado-bt').className = `estado-bt ${ui.clase}`;

  estado.bluetoothConectado = estadoBT === 'conectado';
  actualizarUIBluetooth(estado.bluetoothConectado);
}

function actualizarUIBluetooth(conectado) {
  $('btn-bluetooth').textContent = conectado ? '🔵 Desconectar Bastón' : '📡 Conectar Bastón';
  $('btn-bluetooth').className = conectado ? 'btn btn-secundario' : 'btn btn-bluetooth';
}

// ─── Guardado ────────────────────────────────────────────────────────────────
async function guardarRegistro() {
  const caravana = $('input-caravana').value.trim().toUpperCase();
  const peso = parseFloat($('input-peso').value);
  const categoria = $('select-categoria').value;
  const estadoSanitario = $('select-estado').value;
  const vacuna = $('input-vacuna').value.trim();
  const observaciones = $('input-obs').value.trim();

  // Validación
  if (!caravana) {
    mostrarToast('⚠ Escaneá o ingresá una caravana primero', 'advertencia');
    $('input-caravana').focus();
    return;
  }
  if (!peso || peso <= 0 || peso > 1500) {
    mostrarToast('⚠ Ingresá un peso válido (1-1500 kg)', 'advertencia');
    $('input-peso').focus();
    return;
  }

  const btnGuardar = $('btn-guardar');
  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando...';

  try {
    // 1. Asegurar que el animal existe en la tabla maestra
    await guardarAnimal({
      caravana,
      categoria,
      raza: $('select-raza').value,
    });

    // 2. Guardar el registro de manga
    await guardarRegistroManga({
      caravana,
      peso_kg: peso,
      estado_sanitario: estadoSanitario,
      vacuna_aplicada: vacuna,
      observaciones,
      operador: estado.operador,
    });

    mostrarToast(`✓ Guardado: ${caravana} — ${peso} kg`, 'exito');
    await actualizarContadorPendientes();

    // Vibrar confirmación
    if ('vibrate' in navigator) navigator.vibrate([200]);

    // Limpiar para el siguiente animal (mantener categoría y operador)
    const catActual = $('select-categoria').value;
    limpiarFormulario();
    $('select-categoria').value = catActual;

  } catch (error) {
    console.error('[App] Error al guardar:', error);
    mostrarToast(`✗ Error: ${error.message}`, 'error');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = '💾 GUARDAR';
  }
}

// ─── Historial ────────────────────────────────────────────────────────────────
async function cargarHistorialAnimal(caravana) {
  const registros = await historialAnimal(caravana);
  const contenedor = $('historial');

  if (registros.length === 0) {
    contenedor.innerHTML = '<p class="sin-historial">Animal nuevo — sin registros anteriores</p>';
    return;
  }

  contenedor.innerHTML = registros.slice(0, 5).map(r => `
    <div class="historial-item">
      <span class="historial-fecha">${r.fecha}</span>
      <span class="historial-peso">${r.peso_kg} kg</span>
      <span class="historial-estado estado-${r.estado_sanitario}">${r.estado_sanitario.replace('_', ' ')}</span>
      <span class="historial-sync">${r.sincronizado === 1 ? '✓' : r.sincronizado === 2 ? '⚠' : '○'}</span>
    </div>
  `).join('');
}

// ─── Conectividad ────────────────────────────────────────────────────────────
function manejarCambioConectividad(estadoRed, datos = {}) {
  const indicador = $('estado-red');

  const mapa = {
    online: { texto: '● Online', clase: 'online' },
    offline: { texto: '○ Sin señal', clase: 'offline' },
    sincronizando: { texto: '↑ Sincronizando...', clase: 'sincronizando' },
    sync_completada: { texto: `● Online — ${datos.exitosos ?? 0} sync`, clase: 'online' },
    sync_error: { texto: '● Online (error sync)', clase: 'advertencia' },
  };

  const ui = mapa[estadoRed] || { texto: estadoRed, clase: '' };
  indicador.textContent = ui.texto;
  indicador.className = `estado-red ${ui.clase}`;

  if (estadoRed === 'sync_completada') {
    actualizarContadorPendientes();
  }
}

// ─── Utilidades UI ────────────────────────────────────────────────────────────
function poblarSelects() {
  const selectCat = $('select-categoria');
  CATEGORIAS.forEach(c => {
    selectCat.appendChild(Object.assign(document.createElement('option'), { value: c, textContent: c.charAt(0).toUpperCase() + c.slice(1) }));
  });

  const selectEst = $('select-estado');
  ESTADOS_SANITARIOS.forEach(e => {
    selectEst.appendChild(Object.assign(document.createElement('option'), { value: e, textContent: e.replace('_', ' ') }));
  });

  const selectRaza = $('select-raza');
  RAZAS.forEach(r => {
    selectRaza.appendChild(Object.assign(document.createElement('option'), { value: r, textContent: r }));
  });
}

async function actualizarContadorPendientes() {
  const { total } = await contarPendientes();
  $('contador-pendientes').textContent = total > 0 ? `${total} pendiente${total !== 1 ? 's' : ''}` : '';
  $('btn-sync').style.display = total > 0 ? 'block' : 'none'; // ocultar si no hay pendientes
}

function limpiarFormulario() {
  $('input-caravana').value = '';
  $('input-peso').value = '';
  $('input-vacuna').value = '';
  $('input-obs').value = '';
  $('historial').innerHTML = '';
  estado.caravanaActual = null;
  $('input-caravana').focus();
}

function mostrarToast(mensaje, tipo = 'info', duracion = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  if (duracion > 0) {
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, duracion);
  }
}
