/**
 * app.js — Controlador principal RodeoApp v2
 * 4 tabs: Inicio / Bastón / Manual / Rodeo
 */

import {
  guardarAnimal, guardarRegistroManga, contarPendientes,
  historialAnimal, CATEGORIAS, ESTADOS_SANITARIOS, RAZAS,
  obtenerTodosLosAnimales, obtenerTodosLosRegistros,
  guardarNovedad, obtenerNovedades,
} from './db.js';
import { conectarBaston, desconectarBaston, simularLectura } from './bluetooth.js';
import { inicializarSync, sincronizarPendientes } from './sync.js';
import { inicializarRecorrida, cargarListaRecorridas } from './recorrida.js';
import { inicializarFotos, cargarListaFotos } from './fotos.js';
import { inicializarVideos, cargarListaVideos } from './videos.js';
import { inicializarPush } from './push.js';

// ─── Estado global ────────────────────────────────────────────────────────────
const estado = {
  tabActual: 'inicio',
  bluetoothConectado: false,
  operador: localStorage.getItem('rodeo_operador') || '',
  animalManual: null,       // animal buscado en pestaña Manual
  animalModal: null,        // animal abierto en modal de Rodeo
};

// ─── Selector rápido ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await registrarServiceWorker();
  inicializarSync(manejarCambioConectividad);
  poblarSelects();
  configurarNavegacion();
  configurarEventos();
  inicializarRecorrida(mostrarToast);
  inicializarFotos(mostrarToast);
  inicializarVideos(mostrarToast);
  inicializarPush();
  await actualizarContadorPendientes();

  // Nombre del operador
  if (!estado.operador) {
    const nombre = prompt('¿Nombre del operador?') || 'Operador';
    estado.operador = nombre;
    localStorage.setItem('rodeo_operador', nombre);
  }
  $('operador-nombre').textContent = estado.operador;

  // Cargar pestaña inicial
  mostrarTab('inicio');
});

// ─── Service Worker ───────────────────────────────────────────────────────────
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('[App] SW registrado:', reg.scope);
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          mostrarToast('Nueva versión disponible. Recargá la página.', 'info', 0);
        }
      });
    });
  } catch (e) {
    console.error('[App] Error registrando SW:', e);
  }
}

// ─── NAVEGACIÓN POR TABS ──────────────────────────────────────────────────────
function configurarNavegacion() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      mostrarTab(tab);
    });
  });
}

async function mostrarTab(nombre) {
  estado.tabActual = nombre;

  // Paneles
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('oculto'));
  const panel = $(`tab-${nombre}`);
  if (panel) panel.classList.remove('oculto');

  // Nav items
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const navBtn = $(`nav-${nombre}`);
  if (navBtn) navBtn.classList.add('active');

  // Header título por pestaña
  const titulos = {
    inicio:     ['RodeoApp', 'Los Aromos'],
    baston:     ['Bastón Lector', 'Escanear animal'],
    manual:     ['Carga Manual', 'Buscar y editar'],
    rodeo:      ['Rodeo', 'Todos los animales'],
    recorrida:  ['Recorrida', 'Grabar el campo'],
  };
  const [titulo, sub] = titulos[nombre] || ['RodeoApp', ''];
  $('header-titulo').textContent = titulo;
  $('header-subtitulo').textContent = sub;

  // Cargar datos según pestaña
  if (nombre === 'inicio')    await cargarInicio();
  if (nombre === 'rodeo')     await cargarRodeo();
  if (nombre === 'recorrida') {
    await cargarListaRecorridas();
    await cargarListaFotos();
    await cargarListaVideos();
  }
}

// ─── INICIO ───────────────────────────────────────────────────────────────────
async function cargarInicio() {
  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const hora = hoy.getHours();
  const saludo = hora < 12 ? 'Buenos días,' : hora < 19 ? 'Buenas tardes,' : 'Buenas noches,';

  $('inicio-fecha').textContent = fechaStr;
  $('inicio-saludo').textContent = saludo;
  $('inicio-op-nombre').textContent = estado.operador;

  // Stats del día
  const fechaHoy = hoy.toISOString().split('T')[0];
  const [todosRegistros, { total: pendientes }] = await Promise.all([
    obtenerTodosLosRegistros(),
    contarPendientes(),
  ]);

  const regHoy = todosRegistros.filter(r => r.fecha === fechaHoy);
  const caravanasHoy = new Set(regHoy.map(r => r.caravana));
  const pesosHoy = regHoy.map(r => r.peso_kg).filter(p => p > 0);
  const pesoProm = pesosHoy.length
    ? Math.round(pesosHoy.reduce((a, b) => a + b, 0) / pesosHoy.length)
    : null;

  $('stat-registros').textContent = regHoy.length;
  $('stat-animales').textContent = caravanasHoy.size;
  $('stat-pendientes').textContent = pendientes;
  $('stat-peso-prom').textContent = pesoProm ? `${pesoProm} kg` : '—';

  // Novedades guardadas
  await cargarListaNovedades();
}

async function cargarListaNovedades() {
  const novedades = await obtenerNovedades();
  const lista = $('lista-novedades');

  if (!novedades.length) {
    lista.innerHTML = '<p class="sin-historial">Sin novedades registradas</p>';
    return;
  }

  lista.innerHTML = novedades.slice(0, 10).map(n => `
    <div class="novedad-item">
      <div class="novedad-fecha">${n.fecha} — ${n.operador || estado.operador}</div>
      <div class="novedad-texto">${n.texto}</div>
    </div>
  `).join('');
}

// ─── BASTÓN ───────────────────────────────────────────────────────────────────
function manejarEstadoBluetooth(estadoBT, mensaje) {
  const mapa = {
    buscando:     { texto: 'Buscando...', clase: 'buscando' },
    conectando:   { texto: 'Conectando...', clase: 'buscando' },
    conectado:    { texto: `🔵 ${mensaje}`, clase: 'conectado' },
    desconectado: { texto: 'Bastón no conectado', clase: 'desconectado' },
    cancelado:    { texto: 'Cancelado', clase: 'desconectado' },
    reconectando: { texto: 'Reconectando...', clase: 'buscando' },
    error:        { texto: `Error: ${mensaje}`, clase: 'error' },
  };

  const ui = mapa[estadoBT] || { texto: estadoBT, clase: '' };
  $('estado-bt').textContent = ui.texto;
  $('estado-bt').className = `estado-bt ${ui.clase}`;

  estado.bluetoothConectado = estadoBT === 'conectado';
  $('btn-bluetooth').textContent = estado.bluetoothConectado ? '🔵 Desconectar Bastón' : '📡 Conectar Bastón';
  $('btn-bluetooth').className = estado.bluetoothConectado ? 'btn btn-secundario' : 'btn btn-bluetooth';
}

function caravanaRecibida(caravana) {
  $('input-caravana').value = caravana;
  if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);

  $('input-caravana').classList.add('flash-lectura');
  setTimeout(() => $('input-caravana').classList.remove('flash-lectura'), 600);

  $('input-peso').focus();
  mostrarToast(`✓ Caravana ${caravana} leída`, 'exito', 2000);
  cargarHistorialAnimal(caravana);
}

async function cargarHistorialAnimal(caravana) {
  const registros = await historialAnimal(caravana);
  const contenedor = $('historial');

  if (!registros.length) {
    contenedor.innerHTML = '<p class="sin-historial">Animal nuevo — sin registros anteriores</p>';
    return;
  }

  contenedor.innerHTML = registros.slice(0, 5).map(r => `
    <div class="historial-item">
      <span class="historial-fecha">${r.fecha}</span>
      <span class="historial-peso">${r.peso_kg} kg</span>
      <span class="historial-estado estado-${r.estado_sanitario}">${(r.estado_sanitario || '').replace('_', ' ')}</span>
      <span class="historial-sync">${r.sincronizado === 1 ? '✓' : r.sincronizado === 2 ? '⚠' : '○'}</span>
    </div>
  `).join('');
}

async function guardarRegistro() {
  const caravana = $('input-caravana').value.trim().toUpperCase();
  const peso = parseFloat($('input-peso').value);
  const categoria = $('select-categoria').value;
  const estadoSanitario = $('select-estado').value;
  const vacuna = $('input-vacuna').value.trim();
  const observaciones = $('input-obs').value.trim();

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

  const btn = $('btn-guardar');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    await guardarAnimal({ caravana, categoria, raza: $('select-raza').value });
    await guardarRegistroManga({ caravana, peso_kg: peso, estado_sanitario: estadoSanitario, vacuna_aplicada: vacuna, observaciones, operador: estado.operador });

    mostrarToast(`✓ Guardado: ${caravana} — ${peso} kg`, 'exito');
    if ('vibrate' in navigator) navigator.vibrate([200]);
    await actualizarContadorPendientes();

    const catActual = $('select-categoria').value;
    limpiarFormulario();
    $('select-categoria').value = catActual;
  } catch (e) {
    console.error('[App] Error al guardar:', e);
    mostrarToast(`✗ Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 GUARDAR';
  }
}

function limpiarFormulario() {
  $('input-caravana').value = '';
  $('input-peso').value = '';
  $('input-vacuna').value = '';
  $('input-obs').value = '';
  $('historial').innerHTML = '';
  $('input-caravana').focus();
}

// ─── CARGA MANUAL ─────────────────────────────────────────────────────────────
async function buscarAnimalManual() {
  const query = $('manual-buscar').value.trim().toUpperCase();
  if (!query) {
    mostrarToast('Ingresá un número de caravana', 'advertencia');
    return;
  }

  const todos = await obtenerTodosLosAnimales();
  const animal = todos.find(a =>
    (a.caravana || '').toUpperCase().includes(query)
  );

  $('manual-resultado').classList.add('oculto');
  $('manual-no-encontrado').classList.add('oculto');

  if (!animal) {
    $('manual-no-encontrado').classList.remove('oculto');
    return;
  }

  estado.animalManual = animal;

  // Mostrar info
  const registros = await historialAnimal(animal.caravana);
  const ultimoReg = registros[0];

  $('manual-animal-info').innerHTML = `
    <span class="animal-chip chip-caravana">${animal.caravana}</span>
    <span class="animal-chip">${animal.categoria || '—'}</span>
    <span class="animal-chip">${animal.raza || '—'}</span>
    ${ultimoReg ? `<span class="animal-chip">${ultimoReg.peso_kg} kg</span>` : ''}
  `;

  // Pre-llenar selects de edición
  $('manual-categoria').value = animal.categoria || CATEGORIAS[0];
  $('manual-raza').value = animal.raza || RAZAS[0];
  $('manual-estado').value = ultimoReg?.estado_sanitario || ESTADOS_SANITARIOS[0];
  $('manual-vacuna').value = ultimoReg?.vacuna_aplicada || '';
  $('manual-comentario').value = '';

  $('manual-resultado').classList.remove('oculto');
}

async function guardarCambiosManual() {
  if (!estado.animalManual) return;

  const comentario = $('manual-comentario').value.trim();
  const nuevaCategoria = $('manual-categoria').value;
  const nuevaRaza = $('manual-raza').value;
  const nuevoEstado = $('manual-estado').value;
  const nuevaVacuna = $('manual-vacuna').value.trim();

  const btn = $('btn-manual-guardar');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    // Actualizar animal si cambió algo
    await guardarAnimal({
      caravana: estado.animalManual.caravana,
      categoria: nuevaCategoria,
      raza: nuevaRaza,
    });

    // Guardar registro con comentario (sin peso obligatorio en carga manual)
    if (comentario || nuevoEstado) {
      await guardarRegistroManga({
        caravana: estado.animalManual.caravana,
        peso_kg: 0,
        estado_sanitario: nuevoEstado,
        vacuna_aplicada: nuevaVacuna,
        observaciones: comentario,
        operador: estado.operador,
      });
    }

    mostrarToast(`✓ ${estado.animalManual.caravana} actualizado`, 'exito');
    if ('vibrate' in navigator) navigator.vibrate([200]);
    await actualizarContadorPendientes();

    // Limpiar
    $('manual-buscar').value = '';
    $('manual-resultado').classList.add('oculto');
    $('manual-comentario').value = '';
    estado.animalManual = null;

  } catch (e) {
    mostrarToast(`✗ Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar cambios';
  }
}

// ─── RODEO ────────────────────────────────────────────────────────────────────
let rodeoTodos = [];

async function cargarRodeo() {
  const [animales, registros] = await Promise.all([
    obtenerTodosLosAnimales(),
    obtenerTodosLosRegistros(),
  ]);

  // Mapear último registro por caravana
  const ultimoReg = {};
  registros.forEach(r => {
    if (!ultimoReg[r.caravana] || r.timestamp_local > ultimoReg[r.caravana].timestamp_local) {
      ultimoReg[r.caravana] = r;
    }
  });

  rodeoTodos = animales.map(a => ({
    ...a,
    ultimoReg: ultimoReg[a.caravana] || null,
    historial: registros.filter(r => r.caravana === a.caravana),
  }));

  aplicarFiltrosRodeo();
}

function aplicarFiltrosRodeo() {
  const texto = ($('rodeo-filtro').value || '').trim().toUpperCase();
  const estadoFiltro = $('rodeo-filtro-estado').value;

  let filtrados = rodeoTodos;

  if (texto) {
    filtrados = filtrados.filter(a =>
      (a.caravana || '').toUpperCase().includes(texto)
    );
  }

  if (estadoFiltro) {
    filtrados = filtrados.filter(a =>
      a.ultimoReg?.estado_sanitario === estadoFiltro
    );
  }

  // Ordenar por caravana
  filtrados.sort((a, b) => (a.caravana || '').localeCompare(b.caravana || ''));

  renderizarRodeo(filtrados);
}

function renderizarRodeo(lista) {
  const contenedor = $('rodeo-lista');
  $('rodeo-total-label').textContent = `${lista.length} animal${lista.length !== 1 ? 'es' : ''}`;

  if (!lista.length) {
    contenedor.innerHTML = '<p class="sin-historial" style="margin: 24px 0;">Sin registros</p>';
    return;
  }

  contenedor.innerHTML = lista.map(a => {
    const reg = a.ultimoReg;
    const est = reg?.estado_sanitario || '';
    const sync = !reg ? '○' : reg.sincronizado === 1 ? '✓' : reg.sincronizado === 2 ? '⚠' : '○';

    return `
      <div class="rodeo-item" data-caravana="${a.caravana}" onclick="abrirModalAnimal('${a.caravana}')">
        <div class="rodeo-item-numero">${a.caravana}</div>
        <div class="rodeo-item-info">
          <div class="rodeo-item-cat">${a.categoria || '—'} · ${a.raza || '—'}</div>
          <div class="rodeo-item-meta">${a.historial?.length || 0} registro${a.historial?.length !== 1 ? 's' : ''}</div>
          ${est ? `<span class="rodeo-badge-estado badge-${est}">${est.replace('_', ' ')}</span>` : ''}
        </div>
        <div class="rodeo-item-derecha">
          <div class="rodeo-item-peso">${reg?.peso_kg ? reg.peso_kg + ' kg' : '—'}</div>
          <div class="rodeo-item-sync">${sync}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Exponer función global para onclick en HTML generado
window.abrirModalAnimal = async function(caravana) {
  const animal = rodeoTodos.find(a => a.caravana === caravana);
  if (!animal) return;

  estado.animalModal = animal;
  $('modal-caravana').textContent = caravana;

  const registros = animal.historial || [];
  const novedades = await obtenerNovedades();
  const novedadesAnimal = novedades.filter(n => n.caravana === caravana);

  $('modal-body').innerHTML = `
    <!-- Características -->
    <div>
      <div class="modal-seccion-titulo">Características</div>
      <div class="modal-caracteristicas">
        <div class="modal-campo">
          <div class="modal-campo-label">Categoría</div>
          <div class="modal-campo-valor">${animal.categoria || '—'}</div>
        </div>
        <div class="modal-campo">
          <div class="modal-campo-label">Raza</div>
          <div class="modal-campo-valor">${animal.raza || '—'}</div>
        </div>
        <div class="modal-campo" style="grid-column: 1 / -1">
          <div class="modal-campo-label">Sincronizado</div>
          <div class="modal-campo-valor">${animal.sincronizado === 1 ? '✓ Enviado' : animal.sincronizado === 2 ? '⚠ Conflicto' : '○ Pendiente'}</div>
        </div>
      </div>
    </div>

    <!-- Historial de pesajes -->
    <div>
      <div class="modal-seccion-titulo">Historial de pesajes (${registros.length})</div>
      ${registros.length === 0
        ? '<p class="sin-historial">Sin registros de pesaje</p>'
        : registros.slice(0, 10).map(r => `
          <div class="modal-registro">
            <div>
              <div class="modal-reg-fecha">${r.fecha} ${r.hora || ''} — ${r.operador || ''}</div>
              ${r.observaciones ? `<div class="modal-reg-obs">${r.observaciones}</div>` : ''}
              ${r.vacuna_aplicada ? `<div class="modal-reg-obs">💉 ${r.vacuna_aplicada}</div>` : ''}
            </div>
            <div class="modal-reg-peso">${r.peso_kg > 0 ? r.peso_kg + ' kg' : '—'}</div>
          </div>
        `).join('')
      }
    </div>

    <!-- Comentarios -->
    <div>
      <div class="modal-seccion-titulo">Comentarios (${novedadesAnimal.length})</div>
      ${novedadesAnimal.length === 0
        ? '<p class="sin-historial">Sin comentarios para este animal</p>'
        : novedadesAnimal.map(n => `
          <div class="modal-comentario">
            <div class="modal-com-fecha">${n.fecha} — ${n.operador}</div>
            <div class="modal-com-texto">${n.texto}</div>
          </div>
        `).join('')
      }
    </div>
  `;

  $('modal-overlay').classList.remove('oculto');
};

// ─── EVENTOS GENERALES ────────────────────────────────────────────────────────
function configurarEventos() {

  // ── BASTÓN ──
  $('btn-bluetooth').addEventListener('click', async () => {
    if (estado.bluetoothConectado) {
      await desconectarBaston();
      estado.bluetoothConectado = false;
      manejarEstadoBluetooth('desconectado', '');
    } else {
      await conectarBaston({ onCaravana: caravanaRecibida, onEstado: manejarEstadoBluetooth });
    }
  });

  $('btn-simular').addEventListener('click', () => simularLectura());
  $('btn-guardar').addEventListener('click', guardarRegistro);
  $('btn-limpiar').addEventListener('click', limpiarFormulario);

  $('input-caravana').addEventListener('change', e => {
    const val = e.target.value.trim().toUpperCase();
    if (val) caravanaRecibida(val);
  });

  // ── SYNC ──
  $('btn-sync').addEventListener('click', async () => {
    $('btn-sync').disabled = true;
    $('btn-sync').textContent = 'Sincronizando...';
    const r = await sincronizarPendientes();
    mostrarToast(`☁ ${r.exitosos} enviados, ${r.fallidos} fallidos`, r.fallidos > 0 ? 'advertencia' : 'exito');
    await actualizarContadorPendientes();
    if (estado.tabActual === 'inicio') await cargarInicio();
    $('btn-sync').disabled = false;
    $('btn-sync').textContent = '☁ Sincronizar ahora';
  });

  // ── NOVEDADES DEL DÍA ──
  $('btn-guardar-comentario').addEventListener('click', async () => {
    const texto = $('comentario-dia').value.trim();
    if (!texto) { mostrarToast('Escribí una novedad primero', 'advertencia'); return; }

    await guardarNovedad({ texto, operador: estado.operador });
    $('comentario-dia').value = '';
    mostrarToast('✓ Novedad guardada', 'exito');
    await cargarListaNovedades();
  });

  // ── MANUAL ──
  $('btn-manual-buscar').addEventListener('click', buscarAnimalManual);
  $('manual-buscar').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarAnimalManual();
  });
  $('btn-manual-guardar').addEventListener('click', guardarCambiosManual);

  // ── RODEO filtros ──
  $('rodeo-filtro').addEventListener('input', aplicarFiltrosRodeo);
  $('rodeo-filtro-estado').addEventListener('change', aplicarFiltrosRodeo);

  // ── MODAL cerrar ──
  $('modal-cerrar').addEventListener('click', () => {
    $('modal-overlay').classList.add('oculto');
    estado.animalModal = null;
  });
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) {
      $('modal-overlay').classList.add('oculto');
      estado.animalModal = null;
    }
  });
}

// ─── CONECTIVIDAD ─────────────────────────────────────────────────────────────
function manejarCambioConectividad(estadoRed, datos = {}) {
  const mapa = {
    online:         { texto: '● Online', clase: 'online' },
    offline:        { texto: '○ Sin señal', clase: 'offline' },
    sincronizando:  { texto: '↑ Sincronizando...', clase: 'sincronizando' },
    sync_completada:{ texto: `● Online — ${datos.exitosos ?? 0} sync`, clase: 'online' },
    sync_error:     { texto: '● Online (error sync)', clase: 'advertencia' },
  };
  const ui = mapa[estadoRed] || { texto: estadoRed, clase: '' };
  $('estado-red').textContent = ui.texto;
  $('estado-red').className = `estado-red ${ui.clase}`;
  if (estadoRed === 'sync_completada') actualizarContadorPendientes();
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function poblarSelects() {
  const agregar = (id, lista) => {
    const sel = $(id);
    if (!sel) return;
    lista.forEach(v => {
      sel.appendChild(Object.assign(document.createElement('option'), {
        value: v,
        textContent: v.charAt(0).toUpperCase() + v.slice(1).replace('_', ' '),
      }));
    });
  };

  agregar('select-categoria', CATEGORIAS);
  agregar('select-raza', RAZAS);
  agregar('select-estado', ESTADOS_SANITARIOS);
  agregar('manual-categoria', CATEGORIAS);
  agregar('manual-raza', RAZAS);
  agregar('manual-estado', ESTADOS_SANITARIOS);

  // Filtro de estado en Rodeo
  const selFiltro = $('rodeo-filtro-estado');
  ESTADOS_SANITARIOS.forEach(e => {
    selFiltro.appendChild(Object.assign(document.createElement('option'), {
      value: e,
      textContent: e.replace('_', ' '),
    }));
  });
}

async function actualizarContadorPendientes() {
  const { total } = await contarPendientes();
  const badge = $('contador-pendientes');
  badge.textContent = total > 0 ? `${total} pendiente${total !== 1 ? 's' : ''}` : '';
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
