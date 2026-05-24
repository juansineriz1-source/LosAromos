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
import { inicializarCalendario, cargarFeedHoy } from './calendario.js';
import { inicializarRodeoOficial, cargarRodeoOficial, filtrarRodeo, getAnimales } from './rodeo-oficial.js';
import { initAgenda, cargarAgenda } from './agenda.js';
import { cargarVacunas, calcularAlertasGlobales, estadoVacunasAnimal, registrarVacunacion, getVacunasData } from './vacunas.js';
import { cargarInseminaciones, getInseminacionesData, getInseminacionAnimal, calcularGestacion, alertasPrepartoAnimal, alertasInseminacionGlobales, registrarInseminacion } from './inseminaciones.js';

// ─── Usuarios y roles ─────────────────────────────────────────────────────────
// Mapa base (se sobreescribe con datos de la hoja "Usuarios" al iniciar)
let USUARIOS = {
  'juan':     { display: 'Juan',     rol: 'admin' },
  'juan f':   { display: 'Juan F',   rol: 'admin' },
  'juanf':    { display: 'Juan F',   rol: 'admin' },
  'ana':      { display: 'Ana',      rol: 'admin' },
  'manuela':  { display: 'Manuela',  rol: 'admin' },
  'catalina': { display: 'Catalina', rol: 'admin' },
  'domingo':  { display: 'Domingo',  rol: 'operario' },
  'otro':     { display: 'Otro',     rol: 'operario' },
};

// Lista ordenada de usuarios para el grid del login (se carga desde Sheets)
let USUARIOS_LISTA = [
  { nombre: 'Juan',     rol: 'admin' },
  { nombre: 'Juan F',   rol: 'admin' },
  { nombre: 'Ana',      rol: 'admin' },
  { nombre: 'Manuela',  rol: 'admin' },
  { nombre: 'Catalina', rol: 'admin' },
  { nombre: 'Domingo',  rol: 'operario' },
  { nombre: 'Otro',     rol: 'operario' },
];

const TABS_ADMIN    = ['inicio', 'baston', 'rodeo', 'recorrida', 'agenda'];
const TABS_OPERARIO = ['recorrida', 'rodeo'];

// Tab inicial por usuario (override del default por rol)
const TAB_INICIAL_USUARIO = {
  'domingo': 'recorrida',
  'otro':    'recorrida',
};

function detectarRol(nombre) {
  const clave = (nombre || '').toLowerCase().trim();
  return USUARIOS[clave] || { display: nombre || 'Operario', rol: 'operario' };
}

// ─── Cargar usuarios desde /api/usuarios ──────────────────────────────────────
async function cargarUsuariosDesdeSheets() {
  try {
    const resp = await fetch('/api/animales?modo=usuarios');
    if (!resp.ok) return;
    const lista = await resp.json();
    if (!Array.isArray(lista) || lista.length === 0) return;

    // Reconstruir el mapa USUARIOS
    USUARIOS = {};
    lista.forEach(u => {
      const clave = u.nombre.toLowerCase().trim();
      USUARIOS[clave] = { display: u.nombre, rol: u.rol };
      // Alias sin espacio (ej: "juan f" → "juanf")
      const sinEspacio = clave.replace(/\s+/g, '');
      if (sinEspacio !== clave) USUARIOS[sinEspacio] = { display: u.nombre, rol: u.rol };
    });

    // Actualizar lista para el grid de login
    USUARIOS_LISTA = lista.map(u => ({ nombre: u.nombre, rol: u.rol }));
  } catch (e) {
    console.warn('[usuarios] usando fallback hardcodeado', e);
  }
}

// ─── Estado global ────────────────────────────────────────────────────────────
const estado = {
  tabActual:          'recorrida', // default para operario
  bluetoothConectado: false,
  operador:           localStorage.getItem('rodeo_operador') || '',
  rol:                localStorage.getItem('rodeo_rol')      || '',
  animalManual:       null,
  animalModal:        null,
};

// ─── Selector rápido ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await registrarServiceWorker();
  // Cargar usuarios desde Sheets en paralelo (no bloquea el init)
  cargarUsuariosDesdeSheets();
  inicializarSync(manejarCambioConectividad);
  poblarSelects();
  configurarNavegacion();
  configurarEventos();
  inicializarRecorrida(mostrarToast);
  inicializarFotos(mostrarToast);
  inicializarVideos(mostrarToast);
  inicializarPush();
  await inicializarCalendario();
  await actualizarContadorPendientes();
  inicializarVacunacion();

  // Login: mostrar pantalla de selección si no hay operador guardado
  if (!estado.operador) {
    await mostrarPantallaLogin();
  } else {
    // Restaurar rol desde localStorage
    aplicarRol(estado.rol || 'operario');
    $('operador-nombre').textContent = estado.operador;
    const claveUsuario = (estado.operador || '').toLowerCase();
    const tabInicial = TAB_INICIAL_USUARIO[claveUsuario] ||
                       (estado.rol === 'admin' ? 'inicio' : 'recorrida');
    mostrarTab(tabInicial);
  }
});

// ─── Pantalla de login (diseño Stitch Pro — solo input de nombre) ─────────────
function mostrarPantallaLogin() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'login-overlay';

    overlay.innerHTML = `
      <div class="login-screen">

        <!-- Hero background: vaca colorada -->
        <div class="login-hero-bg">
          <div class="login-hero-img-wrap">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuD1XZpajtb_AMKl-skaKo22A2hf8zJV4k2axV3P0PdojRprrMQ0SQCMgK50AtcUZq0ZrJCV-jWiOu1pFCo2xYOrtcByjdRw1FfvsmHMLv6GKUJJ7RQjm_zUO22pJJmaXHh7YkQfx4U_ID35T3FnQfLoSpurwIvTueEDt1M7tisn7tf8X5iG_zsFZDsqdsOeJ_BjtlC4oH6cCiuuGMLgg2xRPcOWVJPuThewnHc5EM2ofkpyUyb14bRBDhWgcfNbpelBn_CfIxC5UA"
              alt="Rodeo Los Aromos"
              class="login-hero-img"
              onerror="this.style.display='none'"
            >
            <div class="login-hero-gradient"></div>
          </div>
          <div class="login-hero-overlay"></div>
        </div>

        <!-- Contenido -->
        <main class="login-content animate-fade-in">

          <!-- Branding -->
          <div class="login-branding">
            <h1 class="login-titulo-app">RodeoApp</h1>
            <p class="login-subtitulo-app">Los Aromos • Gestión Ganadera</p>
          </div>

          <!-- Card con input -->
          <div class="login-glass-card">
            <form class="login-form" onsubmit="event.preventDefault();">
              <input
                type="text"
                id="login-input"
                class="login-input"
                placeholder="Nombre del operador"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                autocapitalize="words"
              >
              <button class="login-btn-entrar" id="login-btn-entrar" type="submit">
                Ingresar <span class="login-arrow">→</span>
              </button>
            </form>
          </div>

          <p class="login-footer-texto">Sistema Profesional de Administración Rural</p>
        </main>
      </div>
    `;
    document.body.appendChild(overlay);

    const entrar = nombre => {
      const n = (nombre || '').trim();
      if (!n) return;
      const usuario = detectarRol(n);
      estado.operador = usuario.display;
      estado.rol      = usuario.rol;
      localStorage.setItem('rodeo_operador', usuario.display);
      localStorage.setItem('rodeo_rol',      usuario.rol);
      overlay.classList.add('login-saliendo');
      setTimeout(() => {
        overlay.remove();
        aplicarRol(usuario.rol);
        $('operador-nombre').textContent = usuario.display;
        const tabInicial = TAB_INICIAL_USUARIO[usuario.display.toLowerCase()] ||
                           (usuario.rol === 'admin' ? 'inicio' : 'recorrida');
        mostrarTab(tabInicial);
        resolve();
      }, 350);
    };

    const input  = overlay.querySelector('#login-input');
    const btnEnt = overlay.querySelector('#login-btn-entrar');

    btnEnt.addEventListener('click', () => entrar(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') entrar(input.value);
    });

    // Focus automático al aparecer
    setTimeout(() => input.focus(), 400);
  });
}



// ─── Aplicar rol: muestra/oculta tabs según permisos ─────────────────────────
function aplicarRol(rol) {
  const tabsVisibles = rol === 'admin' ? TABS_ADMIN : TABS_OPERARIO;
  const tabsOcultas  = TABS_ADMIN.filter(t => !tabsVisibles.includes(t));

  // Nav items
  TABS_ADMIN.forEach(tab => {
    const navBtn = $(`nav-${tab}`);
    if (!navBtn) return;
    if (tabsVisibles.includes(tab)) {
      navBtn.style.display = '';
    } else {
      navBtn.style.display = 'none';
    }
  });

  // Badge de rol en el header
  const badge = $('operador-nombre');
  if (badge) {
    badge.dataset.rol = rol;
  }

  // Inicializar módulo del rodeo oficial con el rol actual
  inicializarRodeoOficial(mostrarToast, rol === 'admin');

  // Inicializar módulo de agenda con rol y operador actual
  initAgenda(rol === 'admin', estado.operador);
}


// ─── Service Worker ───────────────────────────────────────────────────────────
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('[App] SW registrado:', reg.scope);

    const mostrarBotonUpdate = () => {
      const btn = $('btn-update-sw');
      if (btn) btn.classList.remove('oculto');
    };

    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          // Nueva versión instalada — mostrar botón en lugar de toast
          mostrarBotonUpdate();
        }
      });
    });

    // Botón de actualización forzada
    const btnUpdate = $('btn-update-sw');
    if (btnUpdate) {
      btnUpdate.addEventListener('click', async () => {
        btnUpdate.textContent = '⏳ Actualizando...';
        const sw = reg.waiting || reg.installing;
        if (sw) sw.postMessage('SKIP_WAITING');
        // Esperar que el nuevo SW tome control y recargar
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
        // Fallback: recargar de todas formas a los 2 segundos
        setTimeout(() => window.location.reload(), 2000);
      });
    }

    // Si hay un SW waiting al cargar (update previo pendiente), mostrar botón
    if (reg.waiting) mostrarBotonUpdate();

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
    agenda:     ['Agenda', 'Tareas asignadas'],
  };
  const [titulo, sub] = titulos[nombre] || ['RodeoApp', ''];
  $('header-titulo').textContent = titulo;
  $('header-subtitulo').textContent = sub;

  // Cargar datos según pestaña
  if (nombre === 'inicio')    await cargarInicio();
  if (nombre === 'rodeo')     await cargarRodeoOficial();
  if (nombre === 'agenda')    await cargarAgenda();
  if (nombre === 'recorrida') {
    await cargarListaRecorridas();
    await cargarListaFotos();
    await cargarListaVideos();
  }
}

// ─── INICIO ───────────────────────────────────────────────────────────────────
async function cargarInicio() {
  // Fecha y hora en zona horaria Argentina (UTC-3, sin DST)
  const TZ = 'America/Argentina/Buenos_Aires';
  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ,
  });
  const hora   = parseInt(hoy.toLocaleTimeString('es-AR', { hour: '2-digit', hour12: false, timeZone: TZ }));
  const saludo = hora < 12 ? 'Buenos días,' : hora < 19 ? 'Buenas tardes,' : 'Buenas noches,';

  $('inicio-fecha').textContent = fechaStr;
  $('inicio-saludo').textContent = saludo;
  $('inicio-op-nombre').textContent = estado.operador;

  // Stats del día — fecha en formato YYYY-MM-DD para Argentina
  const fechaHoy = hoy.toLocaleDateString('en-CA', { timeZone: TZ });
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

  // Stats del rodeo oficial (desde Sheets)
  cargarStatsRodeoInicio();

  // Novedades + Feed de hoy
  await cargarFeedHoy();
}

async function cargarStatsRodeoInicio() {
  const contenedor = document.getElementById('rodeo-stats-inicio');
  if (!contenedor) return;
  try {
    const resp = await fetch('/api/animales');
    if (!resp.ok) throw new Error('no disponible');
    const { animales } = await resp.json();

    // Conteos por tipo — mapeamos claves conocidas a nombres legibles
    const TIPO_LABELS = {
      'V':   'Vacas',
      'VQ':  'Vaquillonas',
      'TN':  'Terneros',
      'T':   'Toros',
      'TH':  'Toritos',
      'VA':  'Vaquillonas A',
    };

    const porTipo = {};
    animales.forEach(a => {
      if (!a.tipo) return;
      const clave = a.tipo.toUpperCase().trim();
      porTipo[clave] = (porTipo[clave] || 0) + 1;
    });

    // Ordenar de mayor a menor
    const tiposOrdenados = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);

    const tipoHTML = tiposOrdenados.map(([clave, n]) => `
      <div class="inicio-tipo-card">
        <div class="inicio-tipo-label">${TIPO_LABELS[clave] || clave}</div>
        <div class="inicio-tipo-numero">${n}</div>
      </div>
    `).join('');

    contenedor.innerHTML = `
      <div class="inicio-poblacion-wrap">
        <div class="inicio-poblacion-label">POBLACIÓN TOTAL</div>
        <div class="inicio-poblacion-total">${animales.length} animales</div>
      </div>
      <div class="inicio-tipos-grid">
        ${tipoHTML}
      </div>
    `;
  } catch {
    contenedor.innerHTML = '<p class="sin-historial" style="font-size:12px;">Sin conexión al rodeo</p>';
  }
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

// ─── SERVICE WORKER UPDATE ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  navigator.serviceWorker.ready.then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          const btn = document.createElement('button');
          btn.className = 'btn-update-sw';
          btn.textContent = '🔄 Nueva versión disponible - Actualizar';
          btn.onclick = () => {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          };
          document.body.appendChild(btn);
        }
      });
    });
  });
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
  const btnBluetooth = $('btn-bluetooth');
  if (btnBluetooth) btnBluetooth.addEventListener('click', async () => {
    if (estado.bluetoothConectado) {
      await desconectarBaston();
      estado.bluetoothConectado = false;
      manejarEstadoBluetooth('desconectado', '');
    } else {
      await conectarBaston({ onCaravana: caravanaRecibida, onEstado: manejarEstadoBluetooth });
    }
  });

  if ($('btn-simular'))    $('btn-simular').addEventListener('click', () => simularLectura());
  if ($('btn-guardar'))    $('btn-guardar').addEventListener('click', guardarRegistro);
  if ($('btn-limpiar'))   $('btn-limpiar').addEventListener('click', limpiarFormulario);

  const inputCaravana = $('input-caravana');
  if (inputCaravana) {
    inputCaravana.addEventListener('change', e => {
      const val = e.target.value.trim().toUpperCase();
      if (val) caravanaRecibida(val);
    });
  }

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
    await cargarFeedHoy();
  });

  // ── MANUAL ──
  if ($('btn-manual-buscar')) $('btn-manual-buscar').addEventListener('click', buscarAnimalManual);
  if ($('manual-buscar')) $('manual-buscar').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarAnimalManual();
  });
  if ($('btn-manual-guardar')) $('btn-manual-guardar').addEventListener('click', guardarCambiosManual);

  // ── RODEO filtro de búsqueda ──
  const buscarRodeo = document.getElementById('rodeo-of-buscar');
  if (buscarRodeo) {
    buscarRodeo.addEventListener('input', () => {
      // aplicarFiltros está exportada como window.aplicarFiltrosRodeo desde rodeo-oficial.js
      if (window.aplicarFiltrosRodeo) window.aplicarFiltrosRodeo();
    });
  }

  // ── MODAL cerrar ──
  if ($('modal-cerrar')) {
    $('modal-cerrar').addEventListener('click', () => {
      $('modal-overlay').classList.add('oculto');
      estado.animalModal = null;
    });
  }
  if ($('modal-overlay')) {
    $('modal-overlay').addEventListener('click', e => {
      if (e.target === $('modal-overlay')) {
        $('modal-overlay').classList.add('oculto');
        estado.animalModal = null;
      }
    });
  }
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

  // Filtro de estado en Rodeo (elemento ya no existe, omitir sin crash)
  const selFiltro = $('rodeo-filtro-estado');
  if (selFiltro) {
    ESTADOS_SANITARIOS.forEach(e => {
      selFiltro.appendChild(Object.assign(document.createElement('option'), {
        value: e,
        textContent: e.replace('_', ' '),
      }));
    });
  }
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

// ─── VACUNACIÓN ──────────────────────────────────────────────────────────────────────────
let _animalParaVacunar = null;

function inicializarVacunacion() {
  const btnAbrir   = document.getElementById('btn-abrir-vacunacion');
  const btnCerrar  = document.getElementById('btn-cerrar-vacunacion');
  const btnInfo    = document.getElementById('btn-info-vacunas');
  const btnCerrarM = document.getElementById('btn-cerrar-modal-vac');
  const btnCerrarR = document.getElementById('btn-cerrar-modal-reg');
  const btnGuardar = document.getElementById('btn-guardar-reg-vac');
  const panel      = document.getElementById('panel-vacunacion');
  const modalInfo  = document.getElementById('modal-info-vacunas');
  const modalReg   = document.getElementById('modal-registrar-vac');

  if (!btnAbrir) return;

  btnAbrir.addEventListener('click', async () => {
    panel.classList.remove('oculto');
    await cargarVacunas();
    await cargarInseminaciones();
    renderizarPanelVacunacion();
  });

  btnCerrar.addEventListener('click', () => panel.classList.add('oculto'));

  btnInfo.addEventListener('click', () => {
    document.getElementById('vac-modal-body-contenido').innerHTML = construirManualHTML();
    modalInfo.classList.remove('oculto');
  });
  btnCerrarM.addEventListener('click', () => modalInfo.classList.add('oculto'));
  modalInfo.addEventListener('click', e => { if (e.target === modalInfo) modalInfo.classList.add('oculto'); });

  btnCerrarR.addEventListener('click', () => modalReg.classList.add('oculto'));
  modalReg.addEventListener('click', e => { if (e.target === modalReg) modalReg.classList.add('oculto'); });

  btnGuardar.addEventListener('click', async () => {
    if (!_animalParaVacunar) return;
    const vacuna = document.getElementById('reg-vac-select').value;
    const fecha  = document.getElementById('reg-vac-fecha').value;
    if (!vacuna || !fecha) { mostrarToast('Selecciona vacuna y fecha'); return; }

    btnGuardar.textContent = 'Guardando...';
    btnGuardar.disabled = true;
    try {
      await registrarVacunacion({
        caravana:         _animalParaVacunar.caravana || '',
        boton:            _animalParaVacunar.boton    || '',
        categoria:        _animalParaVacunar.tipo     || '',
        vacuna,
        fecha_aplicacion: fecha.split('-').reverse().join('/'),
        lote:             document.getElementById('reg-vac-lote').value,
        veterinario:      document.getElementById('reg-vac-vet').value,
        observaciones:    document.getElementById('reg-vac-obs').value,
      }, estado.operador || 'sistema');
      mostrarToast('✅ Vacunación registrada');
      modalReg.classList.add('oculto');
      await cargarVacunas();
      await cargarInseminaciones();
      renderizarPanelVacunacion();
    } catch (e) {
      mostrarToast('Error al guardar — intentá de nuevo');
    } finally {
      btnGuardar.textContent = '💾 Guardar Vacunación';
      btnGuardar.disabled = false;
    }
  });

  // Chips de categoria
  document.querySelectorAll('.vac-cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.vac-cat-chip').forEach(c => c.classList.remove('activo'));
      chip.classList.add('activo');
      renderizarPanelVacunacion(chip.dataset.cat || '');
    });
  });

  // Modal inseminacion
  const modalIns    = document.getElementById('modal-registrar-ins');
  const btnCerrarI  = document.getElementById('btn-cerrar-modal-ins');
  const btnGuardarI = document.getElementById('btn-guardar-reg-ins');
  const fechaInput  = document.getElementById('reg-ins-fecha');

  if (btnCerrarI)  btnCerrarI.addEventListener('click', () => modalIns.classList.add('oculto'));
  if (modalIns)    modalIns.addEventListener('click', e => { if (e.target === modalIns) modalIns.classList.add('oculto'); });

  // Calculadora de parto en tiempo real
  if (fechaInput) {
    fechaInput.addEventListener('change', () => {
      const calc  = document.getElementById('reg-ins-calc');
      const fParto= document.getElementById('reg-ins-fecha-parto');
      const dParto= document.getElementById('reg-ins-dias-parto');
      const vList = document.getElementById('reg-ins-vacunas-list');

      if (!fechaInput.value) { calc.classList.add('oculto'); return; }
      const fechaIns  = new Date(fechaInput.value);
      const fechaParto= new Date(fechaIns.getTime() + 283 * 86400000);
      const diasParto = Math.floor((fechaParto - new Date()) / 86400000);

      fParto.textContent = fechaParto.toLocaleDateString('es-AR');
      dParto.textContent = diasParto > 0 ? `Faltan ${diasParto} días` : diasParto === 0 ? '¡HOY!' : 'Fecha pasada';

      // Calcular ventanas de vacunacion
      const GESTACION = 283;
      const diasDesde = Math.floor((new Date() - fechaIns) / 86400000);
      const VENTANAS = [
        { label: 'Diarrea Neonatal 1ª dosis', dia: 210 },
        { label: 'Diarrea Neonatal 2ª + Clostridiales', dia: 240 },
        { label: 'IBR+DVB+Lepto (preparto)', dia: GESTACION - 60 },
        { label: 'Clostridiales refuerzo final', dia: GESTACION - 30 },
      ];
      vList.innerHTML = VENTANAS.map(v => {
        const fechaV = new Date(fechaIns.getTime() + v.dia * 86400000);
        const diasV  = Math.floor((fechaV - new Date()) / 86400000);
        const estado = diasV < 0 ? 'pasado' : diasV <= 10 ? 'urgente' : 'proximo';
        const color  = estado === 'urgente' ? '#e65100' : estado === 'pasado' ? '#9ca3af' : '#1a5c30';
        return `<div class="vac-ins-vacuna-row">
          <span class="vac-ins-vacuna-nombre" style="color:${estado==='pasado'?'#9ca3af':''}">${v.label}</span>
          <span class="vac-ins-vacuna-fecha" style="color:${color}">${fechaV.toLocaleDateString('es-AR')} ${diasV<0?'(pasado)':diasV<=10?'(PRONTO!)':''}</span>
        </div>`;
      }).join('');

      calc.classList.remove('oculto');
    });
  }

  if (btnGuardarI) {
    btnGuardarI.addEventListener('click', async () => {
      if (!_animalParaVacunar) return;
      const fecha = document.getElementById('reg-ins-fecha').value;
      if (!fecha) { mostrarToast('Ingresa la fecha de inseminacion'); return; }

      btnGuardarI.textContent = 'Guardando...';
      btnGuardarI.disabled = true;
      try {
        const fechaAR = fecha.split('-').reverse().join('/');
        const result = await registrarInseminacion({
          caravana:           _animalParaVacunar.caravana || '',
          boton:              _animalParaVacunar.boton    || '',
          fecha_inseminacion: fechaAR,
          semen_toro:         document.getElementById('reg-ins-semen').value,
          metodo:             document.getElementById('reg-ins-metodo').value,
          observaciones:      document.getElementById('reg-ins-obs').value,
          estado:             'en_servicio',
        }, typeof estado !== 'undefined' ? estado.operador : 'sistema');

        if (result.fecha_parto_esperada) {
          mostrarToast(`✅ Guardado. Parto estimado: ${result.fecha_parto_esperada}`);
        } else {
          mostrarToast('✅ Inseminacion registrada');
        }
        modalIns.classList.add('oculto');
        await cargarInseminaciones();
        renderizarPanelVacunacion();
      } catch(e) {
        mostrarToast('Error al guardar — intenta de nuevo');
      } finally {
        btnGuardarI.textContent = '💾 Guardar Inseminación';
        btnGuardarI.disabled = false;
      }
    });
  }

  // ── Vacunacion Masiva ──────────────────────────────────────────────────────
  const btnAbrirMasiva  = document.getElementById('btn-abrir-masiva');
  const btnCerrarMasiva = document.getElementById('btn-cerrar-masiva');
  const btnGuardarMas   = document.getElementById('btn-guardar-masiva');
  const modalMasiva     = document.getElementById('modal-vac-masiva');

  let _selMasiva = new Set();
  let _catMasiva = '';

  function tipoCatMasiva(tipo) {
    const t = (tipo || '').toUpperCase().trim();
    if (t === 'T')  return 'Toro';
    if (t === 'TH') return 'Torito';
    if (t === 'TN') return 'Ternero';
    if (t === 'V')  return 'Vaca';
    if (t === 'VQ') return 'Vaquillona';
    return '';
  }

  function renderListaMasiva() {
    const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
    const lista = document.getElementById('masiva-lista-animales');
    const contador = document.getElementById('masiva-contador');
    if (!lista) return;
    const filtrados = _catMasiva
      ? animalesRef.filter(a => tipoCatMasiva(a.tipo) === _catMasiva)
      : animalesRef;
    lista.innerHTML = filtrados.map((a) => {
      const globalIdx = animalesRef.indexOf(a);
      const selec = _selMasiva.has(globalIdx);
      return `
        <div class="masiva-animal-item ${selec ? '' : 'deselected'}" data-idx="${globalIdx}" onclick="toggleAnimalMasiva(${globalIdx})">
          <div class="masiva-check ${selec ? 'checked' : ''}">${selec ? '✓' : ''}</div>
          <div class="masiva-animal-info">
            <div class="masiva-animal-boton">🐄 ${a.boton || a.caravana || '—'}</div>
            <div class="masiva-animal-sub">${a.caravana ? 'CAR: ' + a.caravana + ' · ' : ''}${tipoCatMasiva(a.tipo)} · ${a.estado || '—'}</div>
          </div>
        </div>`;
    }).join('');
    if (contador) contador.textContent = _selMasiva.size + ' seleccionados';
  }

  window.toggleAnimalMasiva = function(globalIdx) {
    if (_selMasiva.has(globalIdx)) _selMasiva.delete(globalIdx);
    else _selMasiva.add(globalIdx);
    renderListaMasiva();
  };

  if (btnAbrirMasiva) {
    btnAbrirMasiva.addEventListener('click', () => {
      const hoy = new Date().toISOString().split('T')[0];
      const mFecha   = document.getElementById('masiva-fecha');
      const mVacuna  = document.getElementById('masiva-vacuna');
      const mLote    = document.getElementById('masiva-lote');
      const mVet     = document.getElementById('masiva-vet');
      const mProg    = document.getElementById('masiva-progreso');
      if (mFecha)  mFecha.value  = hoy;
      if (mVacuna) mVacuna.value = '';
      if (mLote)   mLote.value   = '';
      if (mVet)    mVet.value    = '';
      if (mProg)   mProg.classList.add('oculto');
      _catMasiva = '';
      const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
      _selMasiva = new Set(animalesRef.map((_, i) => i));
      document.querySelectorAll('.masiva-cat-btn').forEach(b => b.classList.remove('activo'));
      const todosBtn = document.querySelector('.masiva-cat-btn[data-cat=""]');
      if (todosBtn) todosBtn.classList.add('activo');
      renderListaMasiva();
      if (modalMasiva) modalMasiva.classList.remove('oculto');
    });
  }

  if (btnCerrarMasiva) btnCerrarMasiva.addEventListener('click', () => { if (modalMasiva) modalMasiva.classList.add('oculto'); });
  if (modalMasiva) modalMasiva.addEventListener('click', e => { if (e.target === modalMasiva) modalMasiva.classList.add('oculto'); });

  document.querySelectorAll('.masiva-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.masiva-cat-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      _catMasiva = btn.dataset.cat || '';
      const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
      animalesRef
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !_catMasiva || tipoCatMasiva(a.tipo) === _catMasiva)
        .forEach(({ i }) => _selMasiva.add(i));
      renderListaMasiva();
    });
  });

  const btnSelTodos = document.getElementById('masiva-sel-todos');
  if (btnSelTodos) {
    btnSelTodos.addEventListener('click', () => {
      const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
      animalesRef
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !_catMasiva || tipoCatMasiva(a.tipo) === _catMasiva)
        .forEach(({ i }) => _selMasiva.add(i));
      renderListaMasiva();
    });
  }

  const btnDeselTodos = document.getElementById('masiva-desel-todos');
  if (btnDeselTodos) {
    btnDeselTodos.addEventListener('click', () => {
      const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
      animalesRef
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !_catMasiva || tipoCatMasiva(a.tipo) === _catMasiva)
        .forEach(({ i }) => _selMasiva.delete(i));
      renderListaMasiva();
    });
  }

  if (btnGuardarMas) {
    btnGuardarMas.addEventListener('click', async () => {
      const vacuna = (document.getElementById('masiva-vacuna') || {}).value;
      const fecha  = (document.getElementById('masiva-fecha')  || {}).value;
      if (!vacuna) { mostrarToast('Selecciona una vacuna'); return; }
      if (!fecha)  { mostrarToast('Ingresa la fecha'); return; }
      if (!_selMasiva.size) { mostrarToast('Selecciona al menos un animal'); return; }
      const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
      const seleccionados = [..._selMasiva].map(i => animalesRef[i]).filter(Boolean);
      const progreso = document.getElementById('masiva-progreso');
      if (progreso) {
        progreso.textContent = `Guardando 0 / ${seleccionados.length}...`;
        progreso.classList.remove('oculto');
      }
      btnGuardarMas.disabled = true;
      btnGuardarMas.textContent = 'Guardando...';
      try {
        const fechaAR = fecha.split('-').reverse().join('/');
        const operadorActual = (typeof estado !== 'undefined' && estado && estado.operador) ? estado.operador : 'sistema';
        const body = {
          modo:             'registro-vacuna-masiva',
          vacuna,
          fecha_aplicacion: fechaAR,
          lote:             (document.getElementById('masiva-lote') || {}).value || '',
          veterinario:      (document.getElementById('masiva-vet')  || {}).value || '',
          operador:         operadorActual,
          animales:         seleccionados.map(a => ({
            caravana:  a.caravana || '',
            boton:     a.boton    || '',
            categoria: tipoCatMasiva(a.tipo) || a.tipo || '',
          })),
        };
        const r = await fetch('/api/animales', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        const result = await r.json();
        if (result.ok) {
          if (progreso) progreso.textContent = `✅ ${result.registrados} animales vacunados correctamente`;
          mostrarToast(`✅ Vacunacion masiva: ${result.registrados} animales`);
          await cargarVacunas();
          renderizarPanelVacunacion();
          setTimeout(() => {
            if (modalMasiva) modalMasiva.classList.add('oculto');
            if (progreso) progreso.classList.add('oculto');
          }, 2000);
        } else {
          throw new Error(result.error || 'Error desconocido');
        }
      } catch(e) {
        const prog2 = document.getElementById('masiva-progreso');
        if (prog2) prog2.classList.add('oculto');
        mostrarToast('Error: ' + e.message);
      } finally {
        btnGuardarMas.disabled = false;
        btnGuardarMas.textContent = '💾 Guardar vacunación masiva';
      }
    });
  }

  // Inicializar modales de raspado y castracion (necesitan DOM listo)
  inicializarRaspado();
  inicializarCastracion();
}


function tipoCategoriaVacLocal(tipo) {
  const t = (tipo || '').toUpperCase().trim();
  if (t === 'T')  return 'Toro';
  if (t === 'TH') return 'Torito';
  if (t === 'TN') return 'Ternero';
  if (t === 'V')  return 'Vaca';
  if (t === 'VQ') return 'Vaquillona';
  return null;
}

function renderizarPanelVacunacion(filtroCategoria = '') {
  const _animales = getAnimales();
  if (!_animales || !_animales.length) return;
  const vacunasData = getVacunasData();
  const insData = getInseminacionesData();

  // Alertas de inseminacion/parto
  const alertasIns = alertasInseminacionGlobales(_animales || [], insData);

  // Alertas globales de vacunas
  const alertas = calcularAlertasGlobales(_animales, vacunasData);
  const contAlerta = document.getElementById('vac-alertas-container');
  if (contAlerta) {
    const todasAlertas = [...alertas, ...alertasIns];
    contAlerta.innerHTML = todasAlertas.length
      ? todasAlertas.map(a => `
        <div class="vac-alerta-card vac-alerta-${a.nivel}">
          <span class="vac-alerta-icono">${a.icono}</span>
          <span>${a.texto}</span>
        </div>`).join('')
      : '<div class="vac-alerta-card" style="background:#e8f5e9;color:#1a5c30;border:1px solid #c8e6c9;"><span class="vac-alerta-icono">✅</span><span>Sin alertas urgentes al dia de hoy</span></div>';
  }

  // Lista de animales
  const lista = document.getElementById('vac-lista-animales');
  if (!lista) return;

  let animalesFiltrados = _animales;
  if (filtroCategoria) {
    animalesFiltrados = _animales.filter(a => tipoCategoriaVacLocal(a.tipo) === filtroCategoria);
  }

  if (!animalesFiltrados.length) {
    lista.innerHTML = '<p class="sin-historial">Sin animales en esta categoría</p>';
    return;
  }

  lista.innerHTML = animalesFiltrados.slice(0, 80).map((a, idx) => {
    // idx relativo al array completo para la funcion global
    const idxGlobal = _animales.indexOf(a);
    const estados = estadoVacunasAnimal(a, vacunasData);
    const hayUrgente = estados.some(e => e.urgente);
    const ins = getInseminacionAnimal(a, insData);
    const gest = ins ? calcularGestacion(ins) : null;
    const alertasPrep = ins ? alertasPrepartoAnimal(ins).filter(v => v.nivel === 'urgente') : [];
    const hayAlertaParto = alertasPrep.length > 0;

    // Detectar si es toro o torito
    const tipoUp = (a.tipo || '').toUpperCase().trim();
    const esToro    = tipoUp === 'T';           // solo Toro (T)
    const sTernero  = tipoUp === 'TM';          // Ternero Macho

    // Último raspado para toros
    let raspBadge = '';
    if (esToro) {
      const raspRegistros = vacunasData.filter(v =>
        v.vacuna === 'Raspado Prepucial (Tricomoniasis/Campylobacter)' &&
        ((v.boton && v.boton === a.boton) || (v.caravana && v.caravana === a.caravana))
      ).sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp));
      const ultRasp = raspRegistros[0];
      if (ultRasp) {
        const resMap = { negativo: '✅ Negativo', positivo: '🔴 Positivo', pendiente: '⏳ Pendiente' };
        const resClase = ultRasp.estado || 'pendiente';
        raspBadge = `<div class="rasp-badge ${resClase}">
          🧫 Raspado: ${resMap[resClase] || resClase} — ${ultRasp.fecha_aplicacion || ''}
        </div>`;
      } else {
        raspBadge = `<div class="rasp-badge pendiente">🧫 Sin raspado registrado</div>`;
      }
    }

    let castBadge = '';
    if (sTernero) {
      const castRegistros = vacunasData.filter(v =>
        v.vacuna === 'Castracion' &&
        ((v.boton && v.boton === a.boton) || (v.caravana && v.caravana === a.caravana))
      ).sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp));
      const ultCast = castRegistros[0];
      castBadge = ultCast
        ? `<div class="cast-badge castrado">✂️ Castrado — ${ultCast.fecha_aplicacion || ''} · ${ultCast.observaciones ? ultCast.observaciones.substring(0,30) : ''}</div>`
        : `<div class="cast-badge no-castrado">✂️ Sin castrar</div>`;
    }

    const barraGest = gest ? `
      <div class="vac-gest-wrap">
        <div class="vac-gest-header">
          <span class="vac-gest-label">🐄 Gest. mes ${gest.mesGestacion} de 9</span>
          <span class="vac-gest-parto">Parto: ${gest.fechaParto ? gest.fechaParto.toLocaleDateString('es-AR') : '—'} ${gest.diasParaParto !== null ? '(' + gest.diasParaParto + 'd)' : ''}</span>
        </div>
        <div class="vac-gest-bar-bg">
          <div class="vac-gest-bar-fill" style="width:${gest.pct}%"></div>
        </div>
        ${gest.semen_toro ? `<div class="vac-gest-semen">🧬 ${gest.semen_toro}</div>` : ''}
        ${alertasPrep.length ? `<div class="vac-gest-alerta">💉 ${alertasPrep[0].texto}</div>` : ''}
      </div>` : '';

    const dotsHtml = estados
      .filter(e => e.vacuna !== 'Raspado Prepucial (Tricomoniasis/Campylobacter)' && e.vacuna !== 'Castracion')
      .map(e => `
      <div class="vac-dot-item ${e.estado}">
        <div class="vac-dot"></div>
        ${e.vacuna.split(' ')[0].replace('(Campana','').replace(')','').trim()}
      </div>`).join('');

    return `
      <div class="vac-animal-card" style="${(hayUrgente || hayAlertaParto) ? 'border-color:#ffcdd2;' : ''}">
        <div class="vac-animal-card-header">
          <div>
            <div class="vac-animal-nombre">${esToro ? '🐂' : sTernero ? '🐃' : '🐄'} ${a.boton || a.caravana || '—'}</div>
            <div class="vac-animal-sub">${a.caravana ? 'CAR: ' + a.caravana + ' · ' : ''}${a.tipo || '—'} · ${a.estado || '—'}</div>
          </div>
          <div style="display:flex;gap:6px;">
            ${esToro
              ? `<button class="vac-btn-rasp" onclick="abrirRegistroRaspado(${idxGlobal})" title="Raspado prepucial">🧫</button>`
              : sTernero
                ? `<button class="vac-btn-cast" onclick="abrirRegistroCastracion(${idxGlobal})" title="Registrar castracion">✂️</button>`
                : `<button class="vac-btn-ins" onclick="abrirRegistroInseminacion(${idxGlobal})" title="Registrar inseminacion">🐄+</button>`
            }
            <button class="vac-btn-registrar" onclick="abrirRegistroVacuna(${idxGlobal})">+ Vacuna</button>
          </div>
        </div>
        ${esToro ? raspBadge : sTernero ? castBadge : barraGest}
        <div class="vac-dots-row">${dotsHtml || '<span style="color:#9ca3af;font-size:12px;">Sin datos registrados</span>'}</div>
      </div>`;
  }).join('');
}

function abrirRegistroVacuna(idx) {
  const a = getAnimales()[idx];
  if (!a) return;
  _animalParaVacunar = a;
  document.getElementById('reg-vac-animal-label').textContent =
    `Animal: ${a.boton || a.caravana || '—'} · Tipo: ${a.tipo || '—'}`;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('reg-vac-fecha').value   = hoy;
  document.getElementById('reg-vac-select').value  = '';
  document.getElementById('reg-vac-lote').value    = '';
  document.getElementById('reg-vac-vet').value     = '';
  document.getElementById('reg-vac-obs').value     = '';
  document.getElementById('modal-registrar-vac').classList.remove('oculto');
}
window.abrirRegistroVacuna = abrirRegistroVacuna;

function abrirRegistroInseminacion(idx) {
  const animalesRef = typeof getAnimales === 'function' ? getAnimales() : [];
  const a = animalesRef[idx];
  if (!a) return;
  _animalParaVacunar = a;
  document.getElementById('reg-ins-animal-label').textContent =
    `Animal: ${a.boton || a.caravana || '—'} · Tipo: ${a.tipo || '—'} · Estado: ${a.estado || '—'}`;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('reg-ins-fecha').value = hoy;
  document.getElementById('reg-ins-semen').value = '';
  document.getElementById('reg-ins-obs').value = '';
  document.getElementById('reg-ins-calc').classList.add('oculto');
  document.getElementById('modal-registrar-ins').classList.remove('oculto');
  // Trigger el calculo
  document.getElementById('reg-ins-fecha').dispatchEvent(new Event('change'));
}
window.abrirRegistroInseminacion = abrirRegistroInseminacion;

// ─── RASPADO PREPUCIAL ────────────────────────────────────────────────────────
function abrirRegistroRaspado(idx) {
  const a = getAnimales()[idx];
  if (!a) return;
  _animalParaVacunar = a;
  document.getElementById('reg-rasp-animal-label').textContent =
    `🐂 ${a.boton || a.caravana || '—'} · ${a.tipo || '—'} · ${a.estado || '—'}`;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('reg-rasp-fecha').value     = hoy;
  document.getElementById('reg-rasp-resultado').value = 'pendiente';
  document.getElementById('reg-rasp-vet').value       = '';
  document.getElementById('reg-rasp-lab').value       = '';
  document.getElementById('reg-rasp-obs').value       = '';
  // Resetear botones de resultado
  document.querySelectorAll('.rasp-res-btn').forEach(b => b.classList.remove('activo'));
  document.querySelector('.rasp-res-btn[data-res="pendiente"]')?.classList.add('activo');
  document.getElementById('modal-registrar-raspado').classList.remove('oculto');
}
window.abrirRegistroRaspado = abrirRegistroRaspado;

// Inicializar listeners del modal de raspado
function inicializarRaspado() {
  const modalRasp    = document.getElementById('modal-registrar-raspado');
  const btnCerrarR   = document.getElementById('btn-cerrar-modal-rasp');
  const btnGuardarR  = document.getElementById('btn-guardar-reg-rasp');

  if (btnCerrarR) btnCerrarR.addEventListener('click', () => modalRasp?.classList.add('oculto'));
  if (modalRasp)  modalRasp.addEventListener('click', e => { if (e.target === modalRasp) modalRasp.classList.add('oculto'); });

  // Botones de resultado
  document.querySelectorAll('.rasp-res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rasp-res-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      const inp = document.getElementById('reg-rasp-resultado');
      if (inp) inp.value = btn.dataset.res || 'pendiente';
    });
  });

  if (btnGuardarR) {
    btnGuardarR.addEventListener('click', async () => {
      if (!_animalParaVacunar) return;
      const fecha     = document.getElementById('reg-rasp-fecha').value;
      const resultado = document.getElementById('reg-rasp-resultado').value || 'pendiente';
      const vet       = document.getElementById('reg-rasp-vet').value;
      const lab       = document.getElementById('reg-rasp-lab').value;
      const obs       = document.getElementById('reg-rasp-obs').value;

      if (!fecha) { mostrarToast('Ingresá la fecha del raspado'); return; }
      if (!vet)   { mostrarToast('Ingresá el veterinario'); return; }

      btnGuardarR.textContent = 'Guardando...';
      btnGuardarR.disabled = true;

      try {
        const operadorActual = (typeof estado !== 'undefined' && estado?.operador) ? estado.operador : 'sistema';
        const fechaAR = fecha.split('-').reverse().join('/');
        const obsCompleta = `Lab: ${lab || '—'} | ${obs}`.trim();

        await registrarVacunacion({
          caravana:         _animalParaVacunar.caravana || '',
          boton:            _animalParaVacunar.boton    || '',
          categoria:        _animalParaVacunar.tipo     || '',
          vacuna:           'Raspado Prepucial (Tricomoniasis/Campylobacter)',
          tipo_frecuencia:  'anual',
          fecha_aplicacion: fechaAR,
          estado:           resultado,   // negativo / positivo / pendiente
          veterinario:      vet,
          observaciones:    obsCompleta,
        }, operadorActual);

        const emoji = resultado === 'negativo' ? '✅' : resultado === 'positivo' ? '🔴' : '⏳';
        mostrarToast(`${emoji} Raspado registrado: ${resultado}`);

        if (resultado === 'positivo') {
          setTimeout(() => mostrarToast('⚠️ Resultado POSITIVO — aislar al toro del rodeo'), 1500);
        }

        modalRasp?.classList.add('oculto');
        await cargarVacunas();
        renderizarPanelVacunacion();
      } catch(e) {
        mostrarToast('Error al guardar — intentá de nuevo');
        console.error('[raspado]', e);
      } finally {
        btnGuardarR.textContent = '💾 Guardar Raspado';
        btnGuardarR.disabled = false;
      }
    });
  }
}

// ─── CASTRACIÓN ───────────────────────────────────────────────────────────────
function abrirRegistroCastracion(idx) {
  const a = getAnimales()[idx];
  if (!a) return;
  _animalParaVacunar = a;
  document.getElementById('reg-cast-animal-label').textContent =
    `🐃 ${a.boton || a.caravana || '—'} · ${a.tipo || '—'} · ${a.estado || '—'}`;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('reg-cast-fecha').value  = hoy;
  document.getElementById('reg-cast-obs').value    = '';
  document.getElementById('reg-cast-vet').value    = '';
  // Resetear metodo buttons
  document.querySelectorAll('.cast-met-btn').forEach(b => b.classList.remove('activo'));
  document.querySelector('.cast-met-btn[data-met="Quirurgica"]')?.classList.add('activo');
  document.getElementById('reg-cast-metodo').value = 'Quirurgica';
  document.getElementById('modal-registrar-castracion').classList.remove('oculto');
}
window.abrirRegistroCastracion = abrirRegistroCastracion;

function inicializarCastracion() {
  const modalCast   = document.getElementById('modal-registrar-castracion');
  const btnCerrarC  = document.getElementById('btn-cerrar-modal-cast');
  const btnGuardarC = document.getElementById('btn-guardar-reg-cast');

  if (btnCerrarC) btnCerrarC.addEventListener('click', () => modalCast?.classList.add('oculto'));
  if (modalCast)  modalCast.addEventListener('click', e => { if (e.target === modalCast) modalCast.classList.add('oculto'); });

  // Botones de método
  document.querySelectorAll('.cast-met-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cast-met-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      const inp = document.getElementById('reg-cast-metodo');
      if (inp) inp.value = btn.dataset.met || 'Quirurgica';
    });
  });

  if (btnGuardarC) {
    btnGuardarC.addEventListener('click', async () => {
      if (!_animalParaVacunar) return;
      const fecha   = document.getElementById('reg-cast-fecha').value;
      const metodo  = document.getElementById('reg-cast-metodo').value || 'Quirurgica';
      const vet     = document.getElementById('reg-cast-vet').value;
      const obs     = document.getElementById('reg-cast-obs').value;

      if (!fecha) { mostrarToast('Ingresá la fecha de castración'); return; }

      btnGuardarC.textContent = 'Guardando...';
      btnGuardarC.disabled = true;

      try {
        const operadorActual = (typeof estado !== 'undefined' && estado?.operador) ? estado.operador : 'sistema';
        const fechaAR = fecha.split('-').reverse().join('/');
        const obsCompleta = `Método: ${metodo}${vet ? ' | Vet: ' + vet : ''}${obs ? ' | ' + obs : ''}`;

        await registrarVacunacion({
          caravana:         _animalParaVacunar.caravana || '',
          boton:            _animalParaVacunar.boton    || '',
          categoria:        _animalParaVacunar.tipo     || '',
          vacuna:           'Castracion',
          tipo_frecuencia:  'unica',
          fecha_aplicacion: fechaAR,
          estado:           'aplicada',
          veterinario:      vet,
          observaciones:    obsCompleta,
        }, operadorActual);

        mostrarToast('✅ Castración registrada correctamente');
        modalCast?.classList.add('oculto');
        await cargarVacunas();
        renderizarPanelVacunacion();
      } catch(e) {
        mostrarToast('Error al guardar — intentá de nuevo');
        console.error('[castracion]', e);
      } finally {
        btnGuardarC.textContent = '💾 Guardar Castración';
        btnGuardarC.disabled = false;
      }
    });
  }
})();

function construirManualHTML() {
  const VACUNAS_INFO = [
    { nombre: 'Aftosa (Campaña 1)',       oblig: true,  frecuencia: 'Anual',              cat: 'Todo el rodeo',            nota: 'Obligatoria SENASA. Registro SIGSA.' },
    { nombre: 'Aftosa (Campaña 2)',       oblig: true,  frecuencia: 'Anual',              cat: 'Solo terneros/as',         nota: 'Solo refuerzo en terneros desde 2026.' },
    { nombre: 'Brucelosis (Cepa 19)',     oblig: true,  frecuencia: 'UNA VEZ EN LA VIDA', cat: 'Solo terneras 3-8 meses', nota: 'VENTANA NO RECUPERABLE. Vet. autorizado.' },
    { nombre: 'Carbunclo (Antrax)',       oblig: true,  frecuencia: 'Anual (Oct-Nov)',    cat: 'Todo > 6 meses',          nota: 'Obligatorio Prov. BA. Zoonosis.' },
    { nombre: 'Clostridiales',           oblig: false, frecuencia: '2 dosis + anual',    cat: 'Todo el rodeo',           nota: 'No vacunar junto al destete.' },
    { nombre: 'Diarrea Neonatal',        oblig: false, frecuencia: '2 dosis + anual',    cat: 'Vacas/vaquillonas gest.', nota: 'A la madre, 7 y 8 mes gestación.' },
    { nombre: 'Reproductivas (IBR+DVB)', oblig: false, frecuencia: '2 dosis + anual',    cat: 'Vacas, vaquillonas, toros', nota: '60-90 días antes del servicio.' },
    { nombre: 'Queratoconjuntivitis',    oblig: false, frecuencia: '2 dosis + anual',    cat: 'Todo el rodeo',           nota: 'Pre-verano. Controlar moscas.' },
  ];

  return `
    <div class="vac-manual-seccion">
      <div class="vac-manual-titulo">Vacunas Obligatorias</div>
      ${VACUNAS_INFO.filter(v => v.oblig).map(v => `
        <div class="vac-manual-fila">
          <div>
            <div class="vac-manual-nombre">${v.nombre}</div>
            <div style="font-size:11px;color:#6b7a6e;margin-top:3px;">${v.cat}</div>
          </div>
          <div class="vac-manual-detalle">
            <span class="vac-manual-badge vac-badge-obligatoria">OBLIGATORIA</span><br>
            <span style="font-size:11px;">${v.frecuencia}</span><br>
            <span style="font-size:11px;color:#9ca3af;">${v.nota}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="vac-manual-seccion">
      <div class="vac-manual-titulo">Vacunas Recomendadas</div>
      ${VACUNAS_INFO.filter(v => !v.oblig).map(v => `
        <div class="vac-manual-fila">
          <div>
            <div class="vac-manual-nombre">${v.nombre}</div>
            <div style="font-size:11px;color:#6b7a6e;margin-top:3px;">${v.cat}</div>
          </div>
          <div class="vac-manual-detalle">
            <span class="vac-manual-badge vac-badge-recomendada">Recomendada</span><br>
            <span style="font-size:11px;">${v.frecuencia}</span><br>
            <span style="font-size:11px;color:#9ca3af;">${v.nota}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="vac-manual-seccion">
      <div class="vac-manual-titulo">Reglas de Aplicación</div>
      <div style="font-size:13px;color:#374151;line-height:1.8;">
        1. <strong>Cadena de frío:</strong> 2-8°C siempre. Nunca congelar ni exponer al sol.<br>
        2. <strong>No vacunar</strong> animales enfermos o estresados.<br>
        3. <strong>No vacunar junto al destete</strong> — esperar 15-30 días antes o después.<br>
        4. <strong>Vía SC</strong> (subcutánea): tabla del cuello o post-paleta.<br>
        5. <strong>Intervalo mínimo</strong> entre vacunas distintas: 15 días.<br>
        6. <strong>Registrar siempre</strong>: fecha, marca, lote, vencimiento.
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// GENERACION DE PDF — Manual de Vacunacion Bovina
// ──────────────────────────────────────────────────────────────────────────────
function generarPDFManualVacunacion() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    mostrarToast('Cargando PDF... intenta en un momento');
    return;
  }
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;

  // ─── Paleta ───
  const VERDE   = [26, 92, 48];
  const VERDE_C = [232, 245, 233];
  const ROJO    = [183, 28, 28];
  const NARANJA = [230, 81, 0];
  const GRIS    = [107, 122, 110];
  const NEGRO   = [17, 24, 39];

  let y = 0;

  // ─── PAGINA 1 — Portada ────────────────────────────────────────
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, W, 65, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Manual de Vacunacion Bovina', 18, 28);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text('Los Aromos \u2014 Gestion Ganadera', 18, 40);

  doc.setFontSize(10);
  doc.text('Version Mayo 2026 \u00b7 Buenos Aires / Pampa Huemeda', 18, 52);

  doc.setFillColor(255, 255, 255);
  doc.setTextColor(...VERDE);
  doc.roundedRect(18, 57, 50, 8, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Basado en SENASA Res. 711/2025', 20, 62.5);

  // Subtitulo
  y = 78;
  doc.setTextColor(...GRIS);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('Basado en normativa SENASA vigente y buenas practicas para la region pampeana bonaerense.', 18, y, { maxWidth: 174 });

  // ─── Seccion: Obligatorias ─────────────────────────────────────
  y = 92;
  sectionHeader(doc, 'VACUNAS OBLIGATORIAS', y, VERDE);
  y += 8;

  const OBLIG = [
    { nombre: 'Aftosa (Campana 1)', oblig: 'SI \u2014 SENASA', cat: 'Todo el rodeo', frec: 'Anual', nota: 'Registro SIGSA obligatorio. Sin excepcion.' },
    { nombre: 'Aftosa (Campana 2)', oblig: 'SI \u2014 SENASA', cat: 'Solo terneros/as', frec: 'Anual', nota: 'Desde 2026 solo refuerzo en terneros.' },
    { nombre: 'Brucelosis \u2014 Cepa 19', oblig: 'SI \u2014 SENASA', cat: 'Solo terneras 3\u20138 meses', frec: 'UNA SOLA VEZ EN LA VIDA', nota: 'Ventana NO recuperable. Vet. autorizado. Caravana oficial.' },
    { nombre: 'Carbunclo \u2014 Antrax', oblig: 'SI \u2014 Prov. BA', cat: 'Todo >6 meses', frec: 'Anual (Oct\u2013Nov)', nota: 'Zoonosis. Denuncia obligatoria ante SENASA.' },
  ];

  OBLIG.forEach(v => {
    if (y > 265) { doc.addPage(); y = 18; }
    doc.setFillColor(255, 235, 238);
    doc.roundedRect(18, y, W - 36, 22, 2, 2, 'F');
    doc.setTextColor(...ROJO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('OBLIGATORIA', W - 36, y + 5, { align: 'right' });
    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(v.nombre, 22, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text('Cat.: ' + v.cat + ' | Frecuencia: ' + v.frec, 22, y + 12);
    doc.setTextColor(...NEGRO);
    doc.text(v.nota, 22, y + 18, { maxWidth: W - 50 });
    y += 25;
  });

  // ─── Brucelosis alerta especial ───────────────────────────────
  if (y > 255) { doc.addPage(); y = 18; }
  doc.setFillColor(255, 243, 224);
  doc.roundedRect(18, y, W - 36, 14, 2, 2, 'F');
  doc.setTextColor(...NARANJA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('IMPORTANTE: La ventana de Brucelosis (3\u20138 meses de edad) NO se puede recuperar.', 22, y + 6, { maxWidth: W - 44 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Si la ternera llega a los 8 meses sin vacunar, ya no puede recibir la vacuna oficial. Impacta en comercializacion.', 22, y + 11, { maxWidth: W - 44 });
  y += 20;

  // ─── Seccion: Recomendadas ─────────────────────────────────────
  if (y > 240) { doc.addPage(); y = 18; }
  sectionHeader(doc, 'VACUNAS RECOMENDADAS', y, [100, 130, 100]);
  y += 8;

  const RECOM = [
    { nombre: 'Clostridiales', cat: 'Todo el rodeo', frec: '2 dosis + anual', nota: 'Mancha, gangrena, enterotoxemia. No vacunar junto al destete.' },
    { nombre: 'Diarrea Neonatal (Preparto)', cat: 'Vacas/vaquillonas gestantes', frec: '2 dosis ano 1 + anual', nota: 'Se aplica a la MADRE. Ternero recibe via calostro en primeras 6h.' },
    { nombre: 'Reproductivas (IBR+DVB+Lepto+Campy)', cat: 'Vacas, vaquillonas, toros', frec: '2 dosis + anual', nota: '60\u201390 dias antes del servicio. Critica para reproductivas.' },
    { nombre: 'Queratoconjuntivitis', cat: 'Todo el rodeo', frec: '2 dosis + anual', nota: 'Pre-verano (Oct\u2013Nov). Control de moscas complementario.' },
    { nombre: 'Pasteurella / Mannheimia', cat: 'Terneros bajo estres', frec: '2 dosis + anual', nota: 'Complejo respiratorio bovino. Especialmente destete y feedlot.' },
  ];

  RECOM.forEach(v => {
    if (y > 265) { doc.addPage(); y = 18; }
    doc.setFillColor(...VERDE_C);
    doc.roundedRect(18, y, W - 36, 20, 2, 2, 'F');
    doc.setTextColor(100, 130, 100);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Recomendada', W - 36, y + 5, { align: 'right' });
    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(v.nombre, 22, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text('Cat.: ' + v.cat + ' | Frecuencia: ' + v.frec, 22, y + 11);
    doc.setTextColor(...NEGRO);
    doc.text(v.nota, 22, y + 17, { maxWidth: W - 44 });
    y += 24;
  });

  // ─── NUEVA PAGINA: Calendario ─────────────────────────────────
  doc.addPage();
  y = 18;
  sectionHeader(doc, 'CALENDARIO ANUAL \u2014 PAMPA HUEMEDA (Servicio Nov\u2013Ene)', y, VERDE);
  y += 10;

  const CALENDARIO = [
    { mes: 'Ene\u2013Feb', actividad: 'Pre-parto (8\u00b0 mes)', cat: 'Vacas y vaquillonas gestantes', vac: 'Diarrea Neonatal' },
    { mes: 'Marzo',    actividad: 'CAMPANA AFTOSA 1', cat: 'TODO EL RODEO', vac: 'AFTOSA \u2014 OBLIGATORIA' },
    { mes: 'Mar\u2013Abr', actividad: 'Destete', cat: 'Terneros/as', vac: 'Clostridiales 1\u00aa dosis + Queratoconjuntivitis' },
    { mes: 'Abril',    actividad: '30 dias post-destete', cat: 'Terneros/as', vac: 'Clostridiales 2\u00aa dosis (refuerzo)' },
    { mes: 'Abr\u2013May', actividad: 'Ventana brucelosis', cat: 'Terneras 3\u20138 meses', vac: 'BRUCELOSIS (Cepa 19) \u2014 OBLIGATORIA' },
    { mes: 'May\u2013Jun', actividad: 'Pre-servicio', cat: 'Vaquillonas y Toros', vac: 'Reproductivas 1\u00aa dosis' },
    { mes: 'Junio',    actividad: 'CAMPANA AFTOSA 2', cat: 'Solo terneros/as', vac: 'AFTOSA \u2014 OBLIGATORIA (refuerzo)' },
    { mes: 'Jun\u2013Jul', actividad: 'Pre-servicio refuerzo', cat: 'Vacas, vaquillonas, toros', vac: 'Reproductivas (anual)' },
    { mes: 'Julio',    actividad: 'Evaluacion reproductiva', cat: 'Toros', vac: 'Examen andrologico + raspajes venereas' },
    { mes: 'Oct\u2013Nov', actividad: 'Pre-verano', cat: 'Todo el rodeo >6 meses', vac: 'CARBUNCLO \u2014 OBLIGATORIO Prov. BA' },
    { mes: 'Oct\u2013Nov', actividad: 'Pre-temporada moscas', cat: 'Terneros y adultos', vac: 'Queratoconjuntivitis (refuerzo anual)' },
    { mes: 'Nov',      actividad: 'Inicio servicio', cat: '\u2014', vac: '\u2014' },
    { mes: 'Todo el ano', actividad: 'Ventana brucelosis abierta', cat: 'Terneras que lleguen a 3 meses', vac: 'BRUCELOSIS \u2014 no esperar a la campana' },
  ];

  const esOblig = txt => txt.includes('OBLIGATOR') || txt.includes('CAMPANA') || txt.includes('BRUCELOSIS');

  CALENDARIO.forEach(row => {
    if (y > 268) { doc.addPage(); y = 18; }
    const esO = esOblig(row.vac);
    doc.setFillColor(esO ? 255 : 244, esO ? 235 : 246, esO ? 238 : 244);
    doc.roundedRect(18, y, W - 36, 16, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    if (esO) doc.setTextColor(...ROJO); else doc.setTextColor(...VERDE);
    doc.text(row.mes, 22, y + 6);

    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(row.vac, 22, y + 12, { maxWidth: 120 });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(row.cat, W - 36, y + 7, { align: 'right', maxWidth: 60 });
    doc.text(row.actividad, W - 36, y + 12, { align: 'right', maxWidth: 60 });
    y += 18;
  });

  // ─── NUEVA PAGINA: Esquema por categoria ─────────────────────
  doc.addPage();
  y = 18;
  sectionHeader(doc, 'ESQUEMA POR CATEGORIA', y, VERDE);
  y += 10;

  const CATEGORIAS = [
    {
      titulo: 'TERNEROS Y TERNERAS (0 a 12 meses)',
      rows: [
        ['Al nacer', 'Calostrado', '\u2014', 'Asegurar calostro en primeras 6h'],
        ['2\u20133 meses', 'Clostridiales 1\u00aa dosis', 'Recomendada', 'Con refuerzo a las 3\u20134 semanas'],
        ['3\u20138 meses', 'BRUCELOSIS (solo terneras)', 'OBLIGATORIA', 'Unica vez en la vida. Vet. autorizado.'],
        ['3\u20134 meses', 'Aftosa (Campana 1 si cae)', 'OBLIGATORIA', ''],
        ['6\u20138 meses', 'Aftosa Campana 2 (refuerzo)', 'OBLIGATORIA', 'Segun calendario SENASA'],
        ['Al destete', 'Clostridiales refuerzo', 'Recomendada', 'No vacunar el mismo dia del destete'],
      ]
    },
    {
      titulo: 'VAQUILLONAS',
      rows: [
        ['Pre-servicio', 'IBR + DVB + Leptospira + Campy', 'Recomendada', '60\u201390 dias antes del servicio'],
        ['Pre-servicio', 'Clostridiales (anual)', 'Recomendada', ''],
        ['Campana', 'Aftosa', 'OBLIGATORIA', ''],
        ['Pre-parto', 'Clostridiales + Reproductivas', 'Recomendada', '60\u201330 dias antes del parto'],
      ]
    },
    {
      titulo: 'VACAS',
      rows: [
        ['Ene\u2013Abr', 'Aftosa Campana 1', 'OBLIGATORIA', ''],
        ['Pre-servicio', 'IBR + DVB + Lepto', 'Recomendada', '60\u201390 dias antes'],
        ['8\u00b0 mes gestacion', 'Diarrea Neonatal + Clostridiales', 'Recomendada', 'Protege al ternero via calostro'],
        ['Anual', 'Queratoconjuntivitis', 'Recomendada', 'Si hay historia de brotes'],
      ]
    },
    {
      titulo: 'TOROS',
      rows: [
        ['Campana 1', 'Aftosa', 'OBLIGATORIA', ''],
        ['60 dias antes del servicio', 'IBR + DVB + Lepto + Campy', 'CRITICA', 'Puede transmitir por semen'],
        ['60 dias antes del servicio', 'Clostridiales (anual)', 'Recomendada', ''],
        ['Anual Jul', 'Examen andrologico + raspajes', 'Diagnostico', 'Tricomoniasis y Campylobacter'],
      ]
    },
  ];

  CATEGORIAS.forEach(cat => {
    if (y > 240) { doc.addPage(); y = 18; }
    doc.setFillColor(...VERDE);
    doc.roundedRect(18, y, W - 36, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(cat.titulo, 22, y + 5.5);
    y += 10;

    cat.rows.forEach(row => {
      if (y > 272) { doc.addPage(); y = 18; }
      const esO = row[2].includes('OBLIGAT') || row[2].includes('CRIT');
      doc.setFillColor(esO ? 255 : 249, esO ? 243 : 250, esO ? 224 : 249);
      doc.rect(18, y, W - 36, 10, 'F');
      doc.setTextColor(...NEGRO);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(row[0], 22, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.text(row[1], 56, y + 4);
      if (esO) doc.setTextColor(...ROJO); else doc.setTextColor(100, 130, 100);
      if (!esO) doc.setTextColor(100, 130, 100);
      doc.setFont('helvetica', 'bold');
      doc.text(row[2], W - 36, y + 4, { align: 'right' });
      if (row[3]) {
        doc.setTextColor(...GRIS);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.text(row[3], 22, y + 8.5, { maxWidth: 140 });
      }
      y += 11;
    });
    y += 4;
  });

  // ─── NUEVA PAGINA: Antiparasitarios + Reglas ─────────────────
  doc.addPage();
  y = 18;
  sectionHeader(doc, 'ANTIPARASITARIOS \u2014 Complemento del Plan Sanitario', y, [100, 130, 100]);
  y += 10;

  doc.setFillColor(255, 243, 224);
  doc.roundedRect(18, y, W - 36, 14, 2, 2, 'F');
  doc.setTextColor(...NARANJA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('ALERTA INTA 2025\u20132026:', 22, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...NEGRO);
  doc.text('Resistencia documentada a ivermectina y doramectina. No desparasitar de rutina sin diagnostico previo (HPG).', 22, y + 11, { maxWidth: W - 44 });
  y += 18;

  const ANTIPAR = [
    ['Avermectinas (ivermectina, doramectina)', 'Segun HPG', 'Riesgo de resistencia \u2014 no usar rutinariamente'],
    ['Levamisol', 'Segun HPG', 'Mantiene eficacia >98% donde hay resistencia a avermectinas'],
    ['Albendazol / Fenbendazol', 'Segun HPG', 'Para fasciola hepatica en zonas de banados'],
    ['Garrapaticidas (piretroides)', 'Segun infestacion', 'Mas frecuente en verano / zona norte BA'],
    ['Vitaminas A, D, E', '1\u20132 veces/ano', 'Pre-invierno y preparto'],
    ['Minerales (selenio, cobre, zinc)', 'Semestral o anual', 'Critico en suelos pampeanos'],
  ];

  ANTIPAR.forEach(row => {
    if (y > 270) { doc.addPage(); y = 18; }
    doc.setFillColor(...VERDE_C);
    doc.rect(18, y, W - 36, 10, 'F');
    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(row[0], 22, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(row[1] + ' \u2014 ' + row[2], 22, y + 8.5, { maxWidth: W - 44 });
    y += 11;
  });

  y += 6;
  if (y > 240) { doc.addPage(); y = 18; }
  sectionHeader(doc, 'REGLAS GENERALES DE APLICACION', y, VERDE);
  y += 10;

  const REGLAS = [
    '1. Cadena de frio: 2\u20138 \u00b0C siempre. Nunca congelar ni exponer al sol.',
    '2. No vacunar animales enfermos, estresados o debilitados.',
    '3. No vacunar junto al destete \u2014 esperar 15\u201330 dias antes o despues.',
    '4. Via SC (subcutanea): tabla del cuello o post-paleta \u2014 no en la pierna.',
    '5. Intervalo minimo entre vacunas distintas: 15 dias.',
    '6. Registrar siempre: fecha, marca comercial, lote y vencimiento.',
  ];

  REGLAS.forEach(r => {
    if (y > 275) { doc.addPage(); y = 18; }
    doc.setTextColor(...NEGRO);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(r, 22, y);
    y += 7;
  });

  // ─── NUEVA PAGINA: Registros SENASA ──────────────────────────
  doc.addPage();
  y = 18;
  sectionHeader(doc, 'REGISTROS Y SENASA \u2014 SIGSA', y, VERDE);
  y += 10;

  const DOCS = [
    'Actas de vacunacion aftosa (ultima campana)',
    'Certificados de brucelosis de TODAS las terneras vacunadas',
    'Registro del veterinario acreditado asignado al establecimiento',
    'Historial de carbunclo del campo',
  ];

  doc.setTextColor(...NEGRO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Documentos que debe tener el campo:', 18, y);
  y += 6;

  DOCS.forEach(d => {
    doc.setFillColor(...VERDE_C);
    doc.roundedRect(18, y, W - 36, 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...NEGRO);
    doc.text('[ ] ' + d, 22, y + 5.5);
    y += 10;
  });

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Obligaciones del productor (Res. SENASA 201/2026):', 18, y);
  y += 7;

  const OBLIG_PROD = [
    '1. Designar un veterinario acreditado ante SENASA.',
    '2. Actas de vacunacion: el vet. emite el acta despues de cada campana.',
    '3. Recategorizacion en SIGSA: actualizar datos de terneros antes de cada campana.',
    '4. Certificados de brucelosis: imprescindible para comercializacion de terneras.',
  ];

  OBLIG_PROD.forEach(o => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...NEGRO);
    doc.text(o, 18, y, { maxWidth: W - 36 });
    y += 7;
  });

  // ─── PIE DE PAGINA en todas las paginas ─────────────────────
  const totalPag = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPag; i++) {
    doc.setPage(i);
    doc.setFillColor(...VERDE);
    doc.rect(0, 288, W, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Manual de Vacunacion Bovina \u2014 Los Aromos \u00b7 RodeoApp \u00b7 Mayo 2026 \u00b7 SENASA Res. 711/2025', 18, 293.5);
    doc.text('Pagina ' + i + ' de ' + totalPag, W - 18, 293.5, { align: 'right' });
  }

  // ─── Descargar ────────────────────────────────────────────────
  const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g,'-');
  doc.save('manual-vacunacion-los-aromos-' + fecha + '.pdf');
  mostrarToast('📄 PDF descargado correctamente');
}

// Helper: dibuja el encabezado de seccion
function sectionHeader(doc, texto, y, color) {
  doc.setFillColor(...color);
  doc.rect(18, y, 210 - 36, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(texto, 22, y + 5);
  doc.setTextColor(17, 24, 39);
}

// Conectar boton PDF al evento
document.addEventListener('DOMContentLoaded', () => {
  const btnPDF = document.getElementById('btn-descargar-pdf-vac');
  if (btnPDF) {
    btnPDF.addEventListener('click', () => {
      btnPDF.textContent = 'Generando...';
      btnPDF.disabled = true;
      setTimeout(() => {
        try {
          generarPDFManualVacunacion();
        } catch(e) {
          console.error('[PDF]', e);
          mostrarToast('Error generando PDF');
        } finally {
          btnPDF.textContent = '📄 PDF';
          btnPDF.disabled = false;
        }
      }, 100);
    });
  }
});
