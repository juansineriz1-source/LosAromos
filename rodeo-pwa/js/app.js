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

  // Alertas globales
  const alertas = calcularAlertasGlobales(_animales, vacunasData);
  const contAlerta = document.getElementById('vac-alertas-container');
  if (contAlerta) {
    contAlerta.innerHTML = alertas.length
      ? alertas.map(a => `
        <div class="vac-alerta-card vac-alerta-${a.nivel}">
          <span class="vac-alerta-icono">${a.icono}</span>
          <span>${a.texto}</span>
        </div>`).join('')
      : '<div class="vac-alerta-card" style="background:#e8f5e9;color:#1a5c30;border:1px solid #c8e6c9;"><span class="vac-alerta-icono">✅</span><span>Sin alertas urgentes al día de hoy</span></div>';
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
    const estados   = estadoVacunasAnimal(a, vacunasData);
    const hayUrgente = estados.some(e => e.urgente);
    const dotsHtml   = estados.map(e => `
      <div class="vac-dot-item ${e.estado}">
        <div class="vac-dot"></div>
        ${e.vacuna.split(' ')[0].replace('(Campana', '').replace(')', '').trim()}
      </div>`).join('');

    return `
      <div class="vac-animal-card" style="${hayUrgente ? 'border-color:#ffcdd2;' : ''}">
        <div class="vac-animal-card-header">
          <div>
            <div class="vac-animal-nombre">🐄 ${a.boton || a.caravana || '—'}</div>
            <div class="vac-animal-sub">${a.caravana ? 'CAR: ' + a.caravana + ' · ' : ''}${a.tipo || '—'} · ${a.estado || '—'}</div>
          </div>
          <button class="vac-btn-registrar" onclick="abrirRegistroVacuna(${idxGlobal})">
            + Registrar
          </button>
        </div>
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
