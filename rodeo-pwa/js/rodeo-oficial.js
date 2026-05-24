/**
 * rodeo-oficial.js — Módulo de lectura y edición del rodeo oficial (Google Sheets)
 *
 * Para ADMINS: permite editar Botón, Caravana, Estado, TIPO y demás campos.
 * Cada edición agrega una nueva fila en Sheets (trazabilidad histórica).
 *
 * Para OPERARIOS: solo lectura.
 */
import { obtenerOCrearAnimalUuid, renderizarGaleriaAnimal } from './fotos-animal.js';

// ─── Estado ───────────────────────────────────────────────────────────────────
let _animales   = [];
let _onToast    = null;
let _esAdmin    = false;

// Filtros multi-select
let _filtros = {
  tipos:       new Set(),   // Set de strings — vacío = todos
  estados:     new Set(),   // Set de 'P','V','I' — vacío = todos
  vacunas:     new Set(),   // Set de 'vac_aftosa', etc. — vacío = sin filtro de vacuna
  vacunaEstAño: null,       // null | 'si' | 'no'
  periodoVacuna: 365,       // días hacia atrás para considerar "este año"
};
let _panelFiltrosAbierto = false;

// ─── Opciones de campo ────────────────────────────────────────────────────────
const ESTADOS          = ['P', 'V', 'I'];          // hembras
const ESTADOS_MACHO    = ['S', 'F', 'E', 'R'];     // machos
const ETIQUETAS_ESTADO = {
  P: 'Preñada', V: 'Vacía', I: 'Inseminada',          // hembras
  S: 'En servicio', F: 'Fuera servicio', E: 'En engorde', R: 'Retirado',  // machos
};
// Tipos macho: Toro (T), Torito (TH? no — TH es ternera hembra), Ternero Macho (TM)
const TIPOS_MACHO = new Set(['T', 'TM']);
const isMacho = tipo => TIPOS_MACHO.has((tipo || '').toUpperCase().trim());
// Estados según sexo
const estadosPorTipo = tipo => isMacho(tipo) ? ESTADOS_MACHO : ESTADOS;

const TIPOS = ['V', 'VQ', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V CUT', 'TH', 'TM', 'T'];

const COLORES = ['Negra', 'Colorada'];

// ─── Init ─────────────────────────────────────────────────────────────────────
export function inicializarRodeoOficial(onToast, esAdmin) {
  _onToast = onToast;
  _esAdmin = esAdmin;

  // Botón + agregar animal
  const btnAgregar = document.getElementById('btn-agregar-animal');
  if (btnAgregar) {
    btnAgregar.style.display = esAdmin ? 'flex' : 'none';
    btnAgregar.onclick = () => abrirModalAgregarAnimal();
  }

  // ── Panel de filtros avanzados ──────────────────────────────────────────────
  const btnToggle  = document.getElementById('btn-toggle-filtros');
  const btnLimpiar = document.getElementById('btn-limpiar-filtros');
  const panel      = document.getElementById('panel-filtros');

  // Toggle abrir/cerrar panel
  if (btnToggle && panel) {
    btnToggle.addEventListener('click', () => {
      _panelFiltrosAbierto = !_panelFiltrosAbierto;
      panel.classList.toggle('panel-filtros-visible', _panelFiltrosAbierto);
      btnToggle.classList.toggle('activo', _panelFiltrosAbierto);
    });
  }

  // Limpiar todos los filtros
  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', () => {
      _filtros.tipos.clear();
      _filtros.estados.clear();
      _filtros.vacunas.clear();
      _filtros.vacunaEstAño  = null;
      _filtros.periodoVacuna = 365;
      // Resetear UI
      document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('activo'));
      document.querySelector('[data-grupo="periodo"][data-val="365"]')?.classList.add('activo');
      document.getElementById('vac-toggle-si')?.classList.remove('activo');
      document.getElementById('vac-toggle-no')?.classList.remove('activo');
      document.getElementById('filtro-vacunas-detalle').style.display = 'none';
      _actualizarBarraFiltros();
      aplicarFiltros();
    });
  }

  // ── Secciones colapsables ───────────────────────────────────────────────────
  document.querySelectorAll('.filtro-seccion-header').forEach(header => {
    header.addEventListener('click', () => {
      const seccion = header.dataset.seccion;
      const body    = document.getElementById(`filtro-body-${seccion}`);
      const arrow   = header.querySelector('.filtro-seccion-arrow');
      const abierta = body.style.display !== 'none';
      body.style.display  = abierta ? 'none' : 'block';
      arrow.textContent   = abierta ? '›' : '▾';
    });
  });

  // ── Chips de Tipo (se generan después al cargar datos) ──────────────────────

  // ── Chips de Estado ─────────────────────────────────────────────────────────
  document.querySelectorAll('[data-grupo="estado"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (_filtros.estados.has(val)) {
        _filtros.estados.delete(val);
        btn.classList.remove('activo');
      } else {
        _filtros.estados.add(val);
        btn.classList.add('activo');
      }
      _actualizarBarraFiltros();
      aplicarFiltros();
    });
  });

  // ── Toggle Vacunadas SÍ / NO ────────────────────────────────────────────────
  const toggleSi = document.getElementById('vac-toggle-si');
  const toggleNo = document.getElementById('vac-toggle-no');
  const detalle  = document.getElementById('filtro-vacunas-detalle');

  function _setVacToggle(val) {
    if (_filtros.vacunaEstAño === val) {
      // Deseleccionar
      _filtros.vacunaEstAño = null;
      toggleSi.classList.remove('activo');
      toggleNo.classList.remove('activo');
      detalle.style.display = 'none';
    } else {
      _filtros.vacunaEstAño = val;
      toggleSi.classList.toggle('activo', val === 'si');
      toggleNo.classList.toggle('activo', val === 'no');
      detalle.style.display = val === 'si' ? 'block' : 'none';
      if (val === 'no') {
        // Limpiar chips de vacuna específica al poner NO
        _filtros.vacunas.clear();
        document.querySelectorAll('[data-grupo="vacuna"]').forEach(c => c.classList.remove('activo'));
      }
    }
    _actualizarBarraFiltros();
    aplicarFiltros();
  }

  toggleSi?.addEventListener('click', () => _setVacToggle('si'));
  toggleNo?.addEventListener('click', () => _setVacToggle('no'));

  // ── Chips de Vacuna específica ──────────────────────────────────────────────
  document.querySelectorAll('[data-grupo="vacuna"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (_filtros.vacunas.has(val)) {
        _filtros.vacunas.delete(val);
        btn.classList.remove('activo');
      } else {
        _filtros.vacunas.add(val);
        btn.classList.add('activo');
      }
      _actualizarBarraFiltros();
      aplicarFiltros();
    });
  });

  // ── Chips de Período ────────────────────────────────────────────────────────
  document.querySelectorAll('[data-grupo="periodo"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-grupo="periodo"]').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      _filtros.periodoVacuna = parseInt(btn.dataset.val);
      if (_filtros.vacunaEstAño) aplicarFiltros();
    });
  });

  // Exponer para que app.js pueda llamar desde el buscador
  window.aplicarFiltrosRodeo = aplicarFiltros;
}

// ─── Cargar desde Sheets ──────────────────────────────────────────────────────
export async function cargarRodeoOficial() {
  const contenedor = document.getElementById('rodeo-oficial-lista');
  if (!contenedor) return;

  contenedor.innerHTML = '<p class="sin-historial">Cargando rodeo...</p>';

  try {
    const resp = await fetch('/api/animales');
    if (!resp.ok) throw new Error(`Error ${resp.status}`);
    const { animales, total } = await resp.json();
    _animales = animales;
    renderizarRodeo(animales, total);
  } catch (err) {
    contenedor.innerHTML = `<p class="sin-historial">Sin conexión — datos no disponibles</p>`;
    if (_onToast) _onToast('No se pudo cargar el rodeo oficial', 'advertencia', 3000);
  }
}

// ─── Renderizar lista ─────────────────────────────────────────────────────────
function renderizarRodeo(animales, total) {
  const contenedor = document.getElementById('rodeo-oficial-lista');
  const resumen    = document.getElementById('rodeo-oficial-resumen');
  if (!contenedor) return;

  // Stats usando el listado COMPLETO (no el filtrado)
  const hayFiltros = _filtros.tipos.size || _filtros.estados.size ||
                     _filtros.vacunaEstAño !== null || _filtros.vacunas.size;
  if (resumen) {
    resumen.innerHTML = hayFiltros
      ? `<span class="rodeo-stat-total">${animales.length} <span style="color:var(--gris);font-size:12px;">de ${_animales.length}</span></span>`
      : `<span class="rodeo-stat-total">${total} animales</span>`;
  }

  // Generar chips de Tipo dinámicamente desde los datos reales
  _actualizarChipsTipo();

  if (!animales.length) {
    contenedor.innerHTML = '<p class="sin-historial" style="padding:32px 0">Sin animales en este filtro</p>';
    return;
  }

  contenedor.innerHTML = animales.map((a, i) => {
    const idx         = _animales.indexOf(a);
    const estadoClass = (a.estado || '').toLowerCase().replace(' ', '-');
    const tipoClass   = (a.tipo   || '').toLowerCase().replace(' ', '-');
    const colorDot    = a.color === 'Negra' ? '⚫' : a.color === 'Colorada' ? '🟠' : '';

    return `
      <div class="rodeo-of-item rodeo-of-item-tap" data-idx="${idx}" onclick="abrirDetalleAnimal(${idx})">
        <div class="rodeo-of-ids">
          <div class="rodeo-of-ids-row">
            ${a.boton    ? `<span class="rodeo-of-boton">🐄 ${a.boton}</span>`    : ''}
            ${a.caravana ? `<span class="rodeo-of-caravana">🏷 ${a.caravana}</span>` : ''}
          </div>
          <div class="rodeo-of-badges-row">
            <span class="rodeo-of-tipo  rodeo-tipo-${tipoClass}">${a.tipo   || '—'}</span>
            <span class="rodeo-of-estado rodeo-estado-${estadoClass}">${a.estado || '—'}${a.estado ? ` · ${ETIQUETAS_ESTADO[a.estado] || ''}` : ''}</span>
            ${colorDot ? `<span class="rodeo-of-color">${colorDot} ${a.color}</span>` : ''}
          </div>
        </div>
        ${_esAdmin ? `<button class="rodeo-of-btn-editar" onclick="event.stopPropagation(); abrirEditorAnimal(${idx})">✏️</button>` : '<span class="rodeo-of-chevron">›</span>'}
      </div>
    `;
  }).join('');
}

// ─── Chips de Tipo (dinámicos, multi-select) ───────────────────────────────────
function _actualizarChipsTipo() {
  const wrap = document.getElementById('filtro-chips-tipo');
  if (!wrap || wrap.dataset.generado === 'true') return; // solo generar una vez

  const conteo = {};
  _animales.forEach(a => { if (a.tipo) conteo[a.tipo] = (conteo[a.tipo] || 0) + 1; });
  const tiposOrdenados = Object.entries(conteo).sort((a, b) => b[1] - a[1]);

  wrap.innerHTML = tiposOrdenados.map(([t, n]) =>
    `<button class="filtro-chip" data-grupo="tipo" data-val="${t}">${t} <b>${n}</b></button>`
  ).join('');
  wrap.dataset.generado = 'true';

  // Agregar listeners
  wrap.querySelectorAll('[data-grupo="tipo"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (_filtros.tipos.has(val)) {
        _filtros.tipos.delete(val);
        btn.classList.remove('activo');
      } else {
        _filtros.tipos.add(val);
        btn.classList.add('activo');
      }
      _actualizarBarraFiltros();
      aplicarFiltros();
    });
  });
}

// ─── Barra de filtros activos (chips resumen) ──────────────────────────────────
function _actualizarBarraFiltros() {
  const badge    = document.getElementById('filtros-badge');
  const limpiar  = document.getElementById('btn-limpiar-filtros');

  const ETIQ_VAC = {
    vac_aftosa: 'Aftosa', vac_brucelosis: 'Brucelosis', vac_carbunclo: 'Carbunclo',
    vac_mancha: 'Mancha', vac_queratoconjuntivitis: 'Querato.', vac_otras: 'Otras',
  };
  const ETIQ_ESTADO = {
    P: 'Preñada', V: 'Vacía', I: 'Inseminada',
    S: 'En servicio', F: 'Fuera servicio', E: 'En engorde', R: 'Retirado',
  };

  const chips = [];
  _filtros.tipos.forEach(t   => chips.push(t));
  _filtros.estados.forEach(e => chips.push(ETIQ_ESTADO[e] || e));
  if (_filtros.vacunaEstAño === 'si') {
    if (_filtros.vacunas.size) {
      _filtros.vacunas.forEach(v => chips.push('💉 ' + (ETIQ_VAC[v] || v)));
    } else {
      chips.push('💉 Vacunadas');
    }
  }
  if (_filtros.vacunaEstAño === 'no') chips.push('💉 Sin vacunar');

  const total = chips.length;
  if (badge)   { badge.textContent = total; badge.style.display = total ? 'inline-flex' : 'none'; }
  if (limpiar) { limpiar.style.display = total ? 'inline-flex' : 'none'; }
}

// ─── Aplicar todos los filtros ────────────────────────────────────────────────
function aplicarFiltros() {
  const texto = (document.getElementById('rodeo-of-buscar')?.value || '').toLowerCase().trim();
  let filtrados = _animales;

  // Filtro por Tipo (OR entre tipos seleccionados)
  if (_filtros.tipos.size) {
    filtrados = filtrados.filter(a => _filtros.tipos.has(a.tipo || ''));
  }

  // Filtro por Estado (OR entre estados seleccionados)
  if (_filtros.estados.size) {
    filtrados = filtrados.filter(a => _filtros.estados.has(a.estado || ''));
  }

  // Filtro por Vacunas este año
  if (_filtros.vacunaEstAño !== null) {
    const hoy    = new Date();
    const desde  = new Date(hoy.getTime() - _filtros.periodoVacuna * 24 * 60 * 60 * 1000);

    // Función para parsear fecha "dd/mm/yyyy" → Date
    const parseFecha = str => {
      if (!str) return null;
      const [d, m, y] = str.split('/');
      if (!d || !m || !y) return null;
      return new Date(+y, +m - 1, +d);
    };

    // Campos de vacuna a evaluar
    const camposVac = ['vac_aftosa','vac_brucelosis','vac_carbunclo','vac_mancha','vac_queratoconjuntivitis','vac_otras'];

    const tuvoVacuna = animal => {
      // Si hay vacunas específicas seleccionadas → OR entre ellas
      const camposAEvaluar = _filtros.vacunas.size ? [..._filtros.vacunas] : camposVac;
      return camposAEvaluar.some(campo => {
        const fecha = parseFecha(animal[campo]);
        return fecha && fecha >= desde;
      });
    };

    if (_filtros.vacunaEstAño === 'si') {
      filtrados = filtrados.filter(a => tuvoVacuna(a));
    } else {
      // 'no' → los que NO tuvieron NINGUNA vacuna en el período
      filtrados = filtrados.filter(a => !camposVac.some(campo => {
        const fecha = parseFecha(a[campo]);
        return fecha && fecha >= desde;
      }));
    }
  }

  // Filtro por texto libre
  if (texto) {
    filtrados = filtrados.filter(a =>
      (a.boton     || '').toLowerCase().includes(texto) ||
      (a.caravana  || '').toLowerCase().includes(texto) ||
      (a.tipo      || '').toLowerCase().includes(texto) ||
      (a.estado    || '').toLowerCase().includes(texto) ||
      (a.color     || '').toLowerCase().includes(texto) ||
      (a.comentario|| '').toLowerCase().includes(texto)
    );
  }

  renderizarRodeo(filtrados, _animales.length);
}

// ─── Modal de detalle (todos los usuarios) ─────────────────────────────────
window.abrirDetalleAnimal = function(idx) {
  const a = _animales[idx];
  if (!a) return;

  const existente = document.getElementById('modal-detalle-animal');
  if (existente) existente.remove();

  const estadoLabel = ETIQUETAS_ESTADO[a.estado] || a.estado || '—';
  const estadoClass = (a.estado || '').toLowerCase();
  const tipoClass   = (a.tipo   || '').toLowerCase().replace(' ', '-');
  const colorDot    = a.color === 'Negra' ? '⚫' : a.color === 'Colorada' ? '🟠' : '';

  // Fila de detalle
  const fila = (icono, label, valor) => valor
    ? `<div class="det-fila">
         <span class="det-icono">${icono}</span>
         <div class="det-contenido">
           <span class="det-label">${label}</span>
           <span class="det-valor">${valor}</span>
         </div>
       </div>`
    : '';

  // Cambios históricos (si los hay)
  const hayHistorico = a.boton_viejo || a.caravana_vieja || a.estado_viejo || a.tipo_viejo;
  const historicoHtml = hayHistorico ? `
    <div class="det-seccion-titulo">📋 Cambios registrados</div>
    <div class="det-card det-card-gris">
      ${a.boton_viejo     ? `<div class="det-hist-fila"><span class="det-label">Botón anterior</span><span class="det-valor">${a.boton_viejo}</span></div>`        : ''}
      ${a.caravana_vieja  ? `<div class="det-hist-fila"><span class="det-label">Caravana anterior</span><span class="det-valor">${a.caravana_vieja}</span></div>`   : ''}
      ${a.estado_viejo    ? `<div class="det-hist-fila"><span class="det-label">Estado anterior</span><span class="det-valor">${a.estado_viejo} → ${a.estado}</span></div>` : ''}
      ${a.tipo_viejo      ? `<div class="det-hist-fila"><span class="det-label">Tipo anterior</span><span class="det-valor">${a.tipo_viejo} → ${a.tipo}</span></div>`     : ''}
    </div>
  ` : '';

  const modal = document.createElement('div');
  modal.id        = 'modal-detalle-animal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-detalle" style="border-radius:24px 24px 0 0; padding:0; max-height:92vh; display:flex; flex-direction:column;">

      <!-- Handle de arrastre -->
      <div style="display:flex;justify-content:center;padding:10px 0 4px;">
        <div style="width:40px;height:4px;border-radius:99px;background:rgba(0,0,0,0.15);"></div>
      </div>

      <!-- Header pegajoso -->
      <div style="padding:0 20px 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--borde);">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${a.boton    ? `<span style="font-size:18px;font-weight:800;color:var(--texto);">🔖 ${a.boton}</span>`    : ''}
            ${a.caravana ? `<span style="font-size:16px;font-weight:700;color:var(--gris);">🏷 ${a.caravana}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
            <span class="rodeo-of-tipo rodeo-tipo-${tipoClass}" style="font-size:13px;">${a.tipo || '—'}</span>
            <span class="rodeo-of-estado rodeo-estado-${estadoClass}" style="font-size:13px;">${a.estado || '—'} · ${estadoLabel}</span>
            ${colorDot ? `<span style="font-size:13px;">${colorDot} ${a.color}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${_esAdmin ? `<button class="rodeo-of-btn-editar" onclick="document.getElementById('modal-detalle-animal').remove(); abrirEditorAnimal(${idx})">✏️</button>` : ''}
          <button id="det-cerrar" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gris);padding:4px;">✕</button>
        </div>
      </div>

      <!-- Contenido scrolleable -->
      <div style="overflow-y:auto;padding:16px 20px 40px;flex:1;">

        <!-- Datos principales -->
        <div class="det-seccion-titulo">📌 Identificación</div>
        <div class="det-card">
          ${fila('🔖', 'Botón',    a.boton    || '—')}
          ${fila('🏷', 'Caravana', a.caravana || '—')}
          ${fila('🐄', 'Tipo',     a.tipo     || '—')}
          ${fila('❤️', 'Estado',   `${a.estado} — ${estadoLabel}`)}
          ${a.color ? fila('🎨', 'Color', `${colorDot} ${a.color}`) : ''}
        </div>

        <!-- Datos extra -->
        <div class="det-seccion-titulo" style="margin-top:14px;">📋 Información</div>
        <div class="det-card">
          ${fila('📅', 'Última actualización', a.fecha    ? a.fecha.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1') : '')}
          ${fila('👤', 'Registrado por',       a.usuario  || '')}
          ${a.tiene_boton    === 'si' || a.tiene_boton    === 'no' ? fila('🔖', '¿Tiene botón?',    a.tiene_boton   ) : ''}
          ${a.tiene_caravana === 'si' || a.tiene_caravana === 'no' ? fila('🏷', '¿Tiene caravana?', a.tiene_caravana) : ''}
        </div>

        <!-- Comentario -->
        ${a.comentario ? `
          <div class="det-seccion-titulo" style="margin-top:14px;">💬 Comentario</div>
          <div class="det-card det-comentario">
            <p style="margin:0;line-height:1.5;color:var(--texto);">${a.comentario}</p>
          </div>
        ` : ''}

        <!-- Histórico de cambios -->
        ${hayHistorico ? `<div style="margin-top:14px;">${historicoHtml}</div>` : ''}

        <!-- Vacunación -->
        <div class="det-seccion-titulo" style="margin-top:14px;">💉 Vacunación</div>
        <div id="det-vacunas-${idx}" class="det-card" style="padding:12px 14px;">
          <div class="vac-grid" id="vac-grid-${idx}">Cargando...</div>
        </div>

        <!-- Galería de fotos del animal -->
        <div class="det-seccion-titulo" style="margin-top:14px;">📷 Fotos del animal</div>
        <div id="det-galeria-${idx}" style="min-height:48px;">
          <p class="sin-historial" style="font-size:13px;">Cargando fotos...</p>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('det-cerrar').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Cargar galería de fotos del animal
  _cargarGaleriaEnDetalle(a, idx);
  // Renderizar vacunas
  _renderizarVacunas(a, idx);
};

async function _cargarGaleriaEnDetalle(a, idx) {
  const contenedor = document.getElementById(`det-galeria-${idx}`);
  if (!contenedor) return;
  try {
    const uuid = await obtenerOCrearAnimalUuid(a.boton, a.caravana);
    await renderizarGaleriaAnimal(uuid, contenedor, { clickable: true, onFotoClick: src => window.abrirLightbox(src) });
  } catch {
    contenedor.innerHTML = '<p class="sin-historial" style="font-size:13px;">Sin fotos registradas</p>';
  }
}

// ─── Vacunas ──────────────────────────────────────────────────────────────────
const LISTA_VACUNAS = [
  { key: 'vac_aftosa',               id: 'aftosa',               label: 'Aftosa' },
  { key: 'vac_brucelosis',           id: 'brucelosis',           label: 'Brucelosis' },
  { key: 'vac_carbunclo',            id: 'carbunclo',            label: 'Carbunclo' },
  { key: 'vac_mancha',               id: 'mancha',               label: 'Mancha' },
  { key: 'vac_queratoconjuntivitis', id: 'queratoconjuntivitis', label: 'Queratoconjuntivitis' },
  { key: 'vac_otras',               id: 'otras',               label: 'Otras' },
];

function _renderizarVacunas(a, idx) {
  const grid = document.getElementById(`vac-grid-${idx}`);
  if (!grid) return;

  grid.innerHTML = LISTA_VACUNAS.map(v => {
    const fecha     = a[v.key] || '';
    const aplicada  = !!fecha;
    const esOtras   = v.id === 'otras';
    const subtitulo = aplicada
      ? (esOtras && a.vac_comentario_otras ? `✓ ${fecha} — ${a.vac_comentario_otras}` : `✓ ${fecha}`)
      : (_esAdmin ? '+ Registrar' : 'Sin aplicar');

    return `
      <div class="vac-chip ${aplicada ? 'vac-ok' : 'vac-pendiente'} ${_esAdmin ? 'vac-clickable' : ''}"
           onclick="${_esAdmin ? `window._abrirVacunaModal(${idx},'${v.id}')` : ''}">
        <span class="vac-nombre">${v.label}</span>
        <span class="vac-fecha ${aplicada ? '' : 'vac-sin'}">${subtitulo}</span>
      </div>
    `;
  }).join('');
}

window._abrirVacunaModal = async function(idx, vacunaId) {
  const a = _animales[idx];
  if (!a || !_esAdmin) return;

  const vac      = LISTA_VACUNAS.find(v => v.id === vacunaId);
  const campoKey = vac.key;
  const label    = vac.label;
  const esOtras  = vacunaId === 'otras';

  const existente = document.getElementById('modal-vacunar');
  if (existente) existente.remove();

  const hoy    = new Date();
  const hoyISO = `${hoy.getFullYear()}-${(hoy.getMonth()+1).toString().padStart(2,'0')}-${hoy.getDate().toString().padStart(2,'0')}`;

  // Crear modal base
  const dlg = document.createElement('div');
  dlg.id = 'modal-vacunar';
  dlg.className = 'modal-overlay';
  dlg.innerHTML = `
    <div class="modal modal-detalle" style="border-radius:24px 24px 0 0;padding:0;max-height:85vh;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:center;padding:10px 0 4px;">
        <div style="width:40px;height:4px;border-radius:99px;background:rgba(0,0,0,.15);"></div>
      </div>
      <div style="padding:0 20px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--borde);">
        <div>
          <div style="font-size:16px;font-weight:800;">💉 ${label}</div>
          <div style="font-size:12px;color:var(--gris);margin-top:2px;">${a.boton || a.caravana}</div>
        </div>
        <button id="vac-modal-cerrar" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gris);">✕</button>
      </div>
      <div style="overflow-y:auto;padding:16px 20px 32px;flex:1;">

        <!-- Historial -->
        <div class="det-seccion-titulo">📋 Historial de aplicaciones</div>
        <div id="vac-historial-lista" class="det-card" style="margin-bottom:16px;padding:10px 14px;min-height:42px;">
          <p class="sin-historial" style="font-size:13px;">Cargando...</p>
        </div>

        <!-- Nueva aplicación -->
        <div class="det-seccion-titulo">+ Nueva aplicación</div>
        <div class="det-card" style="padding:14px;">
          <label style="font-size:12px;font-weight:700;color:var(--texto-secundario);display:block;margin-bottom:6px;">FECHA DE APLICACIÓN</label>
          <input id="vac-fecha-input" type="date" value="${hoyISO}"
                 style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--borde);font-size:15px;box-sizing:border-box;margin-bottom:${esOtras ? '12px' : '0'};">
          ${esOtras ? `
            <label style="font-size:12px;font-weight:700;color:var(--texto-secundario);display:block;margin-bottom:6px;">¿QUÉ VACUNA?</label>
            <input id="vac-comentario-input" type="text" placeholder="Ej: IBR, Clostridium, Leptospira..."
                   value="${a.vac_comentario_otras || ''}"
                   style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--borde);font-size:15px;box-sizing:border-box;">
          ` : ''}
          <button id="vac-confirmar" style="width:100%;margin-top:14px;padding:13px;background:var(--verde-oscuro);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
            ✓ Confirmar aplicación
          </button>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  document.getElementById('vac-modal-cerrar').addEventListener('click', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

  // Cargar historial en paralelo
  _cargarHistorialVacuna(a, vacunaId, campoKey);

  // Confirmar nueva aplicación
  document.getElementById('vac-confirmar').addEventListener('click', async () => {
    const rawDate       = document.getElementById('vac-fecha-input').value;
    const [y, m, d]     = rawDate.split('-');
    const fechaFmt      = `${d}/${m}/${y}`;
    const comentOtras   = esOtras
      ? (document.getElementById('vac-comentario-input')?.value || '').trim()
      : '';

    const btn = document.getElementById('vac-confirmar');
    btn.textContent = 'Registrando...';
    btn.disabled    = true;

    try {
      const resp = await fetch('/api/actualizar-animal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo:             'vacunar',
          vacuna:           vacunaId,
          fecha:            fechaFmt,
          comentario_otras: comentOtras,
          usuario:          a.usuario || 'Admin',
          animal_actual:    a,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        // Actualizar en memoria
        const update = { [campoKey]: fechaFmt, fecha_vacuna: fechaFmt };
        if (esOtras && comentOtras) update.vac_comentario_otras = comentOtras;
        _animales[idx] = { ..._animales[idx], ...update };
        dlg.remove();
        _renderizarVacunas(_animales[idx], idx);
        _onToast && _onToast(`✓ ${label} registrada el ${fechaFmt}`);
      } else {
        _onToast && _onToast('Error: ' + data.error);
        btn.textContent = '✓ Confirmar aplicación';
        btn.disabled    = false;
      }
    } catch (err) {
      _onToast && _onToast('Error de red: ' + err.message);
      btn.textContent = '✓ Confirmar aplicación';
      btn.disabled    = false;
    }
  });
};

async function _cargarHistorialVacuna(a, vacunaId, campoKey) {
  const contenedor = document.getElementById('vac-historial-lista');
  if (!contenedor) return;

  try {
    const qs   = new URLSearchParams({ modo: 'historial-vacunas', boton: a.boton || '', caravana: a.caravana || '' });
    const resp = await fetch(`/api/animales?${qs}`);
    const data = await resp.json();

    // El nuevo API devuelve porVacuna: { vac_aftosa: [{fecha, comentario, usuario}], ... }
    const registros = (data.porVacuna?.[campoKey] || []).slice().reverse(); // más reciente primero

    if (!registros.length) {
      contenedor.innerHTML = '<p class="sin-historial" style="font-size:13px;">Sin aplicaciones previas</p>';
      return;
    }

    contenedor.innerHTML = registros.map((r, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  ${i > 0 ? 'padding-top:8px;border-top:1px solid #f0f0f0;margin-top:8px;' : ''}">
        <div>
          <span style="font-size:14px;font-weight:700;color:${i === 0 ? 'var(--verde-oscuro)' : 'var(--texto)'};">
            ${i === 0 ? '● ' : '○ '}${r.fecha}
          </span>
          ${r.comentario ? `<span style="font-size:12px;color:var(--gris);margin-left:6px;">${r.comentario}</span>` : ''}
          ${r.usuario ? `<span style="font-size:11px;color:#bbb;margin-left:6px;">— ${r.usuario}</span>` : ''}
        </div>
        ${i === 0 ? '<span style="font-size:11px;background:#e6f7ed;color:#2d9c5b;padding:2px 8px;border-radius:99px;font-weight:700;">última</span>' : ''}
      </div>
    `).join('');
  } catch (err) {
    contenedor.innerHTML = '<p class="sin-historial" style="font-size:13px;">Error al cargar historial</p>';
    console.error('[historial-vacuna]', err);
  }
}


// ─── Abrir modal de edición ───────────────────────────────────────────────────
window.abrirEditorAnimal = function(idx) {
  const a = _animales[idx];
  if (!a || !_esAdmin) return;

  const existente = document.getElementById('modal-editor-animal');
  if (existente) existente.remove();

  const modal = document.createElement('div');
  modal.id        = 'modal-editor-animal';
  modal.className = 'modal-overlay';

  modal.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0; padding: 0 0 40px; max-height:92vh; overflow-y:auto;">
      <div class="modal-header" style="position:sticky;top:0;z-index:2;background:var(--verde-oscuro);">
        <div>
          <div class="modal-caravana" style="font-size:18px;">
            ${a.boton ? `🔖 ${a.boton}` : ''} ${a.caravana ? `🏷 ${a.caravana}` : ''}
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px">Editar animal</div>
        </div>
        <button class="modal-cerrar" id="modal-animal-cerrar">✕</button>
      </div>

      <div class="modal-body">

        <!-- IDs -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">🔖 Botón</div>
          <input class="campo-input" id="edit-boton" value="${a.boton || ''}" placeholder="Ej: DG687">
        </div>
        <div class="rodeo-edit-seccion">
          <div class="campo-label">🏷 Caravana</div>
          <input class="campo-input" id="edit-caravana" value="${a.caravana || ''}" placeholder="Ej: E627">
        </div>

        <!-- Estado: diferente según si es macho o hembra -->
        <div class="rodeo-edit-seccion" id="seccion-estado-edit">
          <div class="campo-label">Estado</div>
          <div class="rodeo-edit-opciones" id="edit-estado-opciones">
            ${estadosPorTipo(a.tipo).map(e => `
              <button class="rodeo-edit-chip rodeo-chip-estado-${e.toLowerCase()} ${a.estado === e ? 'activo' : ''}"
                onclick="seleccionarEstado('${e}', this)" data-valor="${e}">
                <span class="chip-codigo">${e}</span>
                <span class="chip-label">${ETIQUETAS_ESTADO[e]}</span>
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="edit-estado" value="${a.estado || ''}">
        </div>

        <!-- TIPO -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Tipo</div>
          <div class="rodeo-edit-opciones">
            ${TIPOS.map(t => `
              <button class="rodeo-edit-chip ${a.tipo === t ? 'activo' : ''}"
                onclick="seleccionarTipo('${t}', this)" data-valor="${t}">
                ${t}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="edit-tipo" value="${a.tipo || ''}">
        </div>

        <!-- Color: Negra / Colorada -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Color</div>
          <div class="rodeo-edit-opciones">
            ${COLORES.map(c => `
              <button class="rodeo-edit-chip rodeo-chip-color-${c.toLowerCase()} ${a.color === c ? 'activo' : ''}"
                onclick="seleccionarColor('${c}', this)" data-valor="${c}">
                ${c === 'Negra' ? '⚫' : '🟠'} ${c}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="edit-color" value="${a.color || ''}">
        </div>

        <!-- Tiene caravana / botón -->
        <div class="grid-2">
          <div class="rodeo-edit-seccion">
            <div class="campo-label">¿Tiene caravana?</div>
            <div class="rodeo-edit-opciones">
              <button class="rodeo-edit-chip ${a.tiene_caravana === 'SI' ? 'activo' : ''}" onclick="toggleSiNo('edit-tiene-caravana', this)" data-valor="SI">SI</button>
              <button class="rodeo-edit-chip ${a.tiene_caravana !== 'SI' ? 'activo' : ''}" onclick="toggleSiNo('edit-tiene-caravana', this)" data-valor="NO">NO</button>
            </div>
            <input type="hidden" id="edit-tiene-caravana" value="${a.tiene_caravana || 'NO'}">
          </div>
          <div class="rodeo-edit-seccion">
            <div class="campo-label">¿Tiene botón?</div>
            <div class="rodeo-edit-opciones">
              <button class="rodeo-edit-chip ${a.tiene_boton === 'SI' ? 'activo' : ''}" onclick="toggleSiNo('edit-tiene-boton', this)" data-valor="SI">SI</button>
              <button class="rodeo-edit-chip ${a.tiene_boton !== 'SI' ? 'activo' : ''}" onclick="toggleSiNo('edit-tiene-boton', this)" data-valor="NO">NO</button>
            </div>
            <input type="hidden" id="edit-tiene-boton" value="${a.tiene_boton || 'SI'}">
          </div>
        </div>

        <!-- Comentario -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Comentario</div>
          <textarea class="campo-textarea" id="edit-comentario" rows="2" placeholder="Observaciones...">${a.comentario || ''}</textarea>
        </div>

        <!-- Guardar -->
        <button class="btn btn-primario" id="btn-guardar-animal" style="margin-top:8px">
          💾 Guardar cambios
        </button>

        <!-- Galeria de fotos del animal -->
        <div class="rodeo-edit-seccion" style="border-top:1px solid #eee;padding-top:14px;margin-top:4px">
          <div class="campo-label">📷 Fotos del animal</div>
          <div id="galeria-animal-modal"></div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cerrar = () => modal.remove();
  document.getElementById('modal-animal-cerrar').addEventListener('click', cerrar);
  modal.addEventListener('click', e => { if (e.target === modal) cerrar(); });
  document.getElementById('btn-guardar-animal').addEventListener('click', async () => {
    await guardarEdicionAnimal(a, cerrar);
  });

  // Cargar galería de fotos del animal
  const animal_uuid = obtenerOCrearAnimalUuid(a.boton, a.caravana);
  renderizarGaleriaAnimal('galeria-animal-modal', animal_uuid, a.boton, a.caravana, _esAdmin);
};

// ─── Helpers de selección ────────────────────────────────────────────────────
window.seleccionarEstado = function(val, btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById('edit-estado').value = val;
};

window.seleccionarTipo = function(val, btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById('edit-tipo').value = val;
  // Actualizar opciones de estado según el nuevo tipo
  const opciones = document.getElementById('edit-estado-opciones');
  const estadoInput = document.getElementById('edit-estado');
  if (opciones) {
    const estados = estadosPorTipo(val);
    opciones.innerHTML = estados.map(e => `
      <button class="rodeo-edit-chip rodeo-chip-estado-${e.toLowerCase()}"
        onclick="seleccionarEstado('${e}', this)" data-valor="${e}">
        <span class="chip-codigo">${e}</span>
        <span class="chip-label">${ETIQUETAS_ESTADO[e]}</span>
      </button>
    `).join('');
    // Limpiar estado seleccionado ya que puede no ser válido
    if (estadoInput) estadoInput.value = '';
  }
};

window.seleccionarColor = function(val, btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById('edit-color').value = val;
};

window.toggleSiNo = function(inputId, btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById(inputId).value = btn.dataset.valor;
};

// ─── Enviar edición al servidor ───────────────────────────────────────────────
async function guardarEdicionAnimal(animal_viejo, cerrarModal) {
  const btn = document.getElementById('btn-guardar-animal');
  btn.disabled    = true;
  btn.textContent = '⏳ Guardando...';

  const payload = {
    // Identificación del animal en el maestro
    row_index:      animal_viejo._rowIndex,
    // Nuevos valores
    boton:          document.getElementById('edit-boton').value.trim(),
    caravana:       document.getElementById('edit-caravana').value.trim(),
    estado:         document.getElementById('edit-estado').value,
    tiene_caravana: document.getElementById('edit-tiene-caravana').value,
    tiene_boton:    document.getElementById('edit-tiene-boton').value,
    tipo:           document.getElementById('edit-tipo').value,
    color:          document.getElementById('edit-color').value,
    comentario:     document.getElementById('edit-comentario').value.trim(),
    usuario:        localStorage.getItem('rodeo_operador') || 'Admin',
    // Vacunas — se preservan tal cual
    fecha_vacuna:             animal_viejo.fecha_vacuna             || '',
    vac_aftosa:               animal_viejo.vac_aftosa               || '',
    vac_brucelosis:           animal_viejo.vac_brucelosis           || '',
    vac_carbunclo:            animal_viejo.vac_carbunclo            || '',
    vac_mancha:               animal_viejo.vac_mancha               || '',
    vac_queratoconjuntivitis: animal_viejo.vac_queratoconjuntivitis || '',
    vac_otras:                animal_viejo.vac_otras                || '',
    vac_comentario_otras:     animal_viejo.vac_comentario_otras     || '',
    // Valores anteriores para el Historial
    boton_viejo:       animal_viejo.boton,
    caravana_vieja:    animal_viejo.caravana,
    estado_viejo:      animal_viejo.estado,
    tipo_viejo:        animal_viejo.tipo,
    color_viejo:       animal_viejo.color,
    comentario_viejo:  animal_viejo.comentario,
  };

  if (!payload.boton && !payload.caravana) {
    if (_onToast) _onToast('Ingresá al menos Botón o Caravana', 'advertencia');
    btn.disabled = false;
    btn.textContent = '💾 Guardar cambios';
    return;
  }

  try {
    const resp = await fetch('/api/actualizar-animal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`Error ${resp.status}`);

    if (_onToast) _onToast(`✓ ${payload.boton || payload.caravana} actualizado`, 'exito', 3000);
    cerrarModal();
    await cargarRodeoOficial();

  } catch (err) {
    if (_onToast) _onToast(`✗ Error: ${err.message}`, 'error', 4000);
    btn.disabled = false;
    btn.textContent = '💾 Guardar cambios';
  }
}

// ─── Filtro de búsqueda (llamado desde app.js al tipear) ──────────────────────
// ─── Getter público para módulo de vacunación ────────────────────────────────
export function getAnimales() { return _animales; }

export function filtrarRodeo(texto) {
  aplicarFiltros(); // usa el texto del input + chip activo
}

// ─── Modal: agregar animal nuevo ──────────────────────────────────────────────
function abrirModalAgregarAnimal() {
  const existente = document.getElementById('modal-agregar-animal');
  if (existente) existente.remove();

  const modal = document.createElement('div');
  modal.id        = 'modal-agregar-animal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0; padding:0 0 40px; max-height:92vh; overflow-y:auto;">
      <div style="position:sticky; top:0; background:var(--bg-card); padding:16px 20px 12px; border-bottom:1px solid var(--borde); display:flex; align-items:center; justify-content:space-between; z-index:10;">
        <span style="font-weight:700; font-size:17px;">➕ Nuevo animal</span>
        <button onclick="document.getElementById('modal-agregar-animal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--texto-secundario)">✕</button>
      </div>
      <div style="padding:20px;">
        <div class="grupo-campo">
          <label class="campo-label">Botón</label>
          <input id="nuevo-boton" class="campo-input" placeholder="Nro de botón..." autocomplete="off">
        </div>
        <div class="grupo-campo" style="margin-top:12px;">
          <label class="campo-label">Caravana</label>
          <input id="nuevo-caravana" class="campo-input" placeholder="Nro de caravana..." autocomplete="off">
        </div>
        <div class="grupo-campo" style="margin-top:12px;">
          <label class="campo-label">Estado</label>
          <select id="nuevo-estado" class="campo-select">
            ${ESTADOS.map(e => `<option value="${e}">${e} — ${ETIQUETAS_ESTADO[e] || e}</option>`).join('')}
          </select>
        </div>
        <div class="grupo-campo" style="margin-top:12px;">
          <label class="campo-label">Tipo</label>
          <select id="nuevo-tipo" class="campo-select">
            ${TIPOS.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="grupo-campo" style="margin-top:12px;">
          <label class="campo-label">Color</label>
          <select id="nuevo-color" class="campo-select">
            ${COLORES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="grupo-campo" style="margin-top:12px;">
          <label class="campo-label">Comentario (opcional)</label>
          <textarea id="nuevo-comentario" class="campo-textarea" rows="2" placeholder="Observaciones..."></textarea>
        </div>
        <button id="btn-guardar-nuevo-animal" class="btn btn-primario" style="margin-top:20px; min-height:56px; width:100%;">
          💾 Agregar animal
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  // Cerrar al tocar el fondo
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Listener dinámico: al cambiar Tipo, actualizar opciones de Estado
  const selectTipo   = modal.querySelector('#nuevo-tipo');
  const selectEstado = modal.querySelector('#nuevo-estado');
  function actualizarOpcionesEstado() {
    const tipo = selectTipo.value;
    const estados = estadosPorTipo(tipo);
    selectEstado.innerHTML = estados
      .map(e => `<option value="${e}">${e} — ${ETIQUETAS_ESTADO[e]}</option>`)
      .join('');
  }
  selectTipo.addEventListener('change', actualizarOpcionesEstado);
  // Disparar al abrir (por defecto el primer tipo del select)
  actualizarOpcionesEstado();

  modal.querySelector('#btn-guardar-nuevo-animal').addEventListener('click', async () => {
    const btn      = modal.querySelector('#btn-guardar-nuevo-animal');
    const boton    = modal.querySelector('#nuevo-boton').value.trim();
    const caravana = modal.querySelector('#nuevo-caravana').value.trim();
    const estado   = modal.querySelector('#nuevo-estado').value;
    const tipo     = modal.querySelector('#nuevo-tipo').value;
    const color    = modal.querySelector('#nuevo-color').value;
    const comentario = modal.querySelector('#nuevo-comentario').value.trim();

    if (!boton && !caravana) {
      if (_onToast) _onToast('Ingresá al menos botón o caravana', 'advertencia', 3000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const TZ    = 'America/Argentina/Buenos_Aires';
      const fecha = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      const hora  = new Date().toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

      const payload = {
        modo: 'nuevo',   // alta nueva → el API hace APPEND en LosAromos
        boton, caravana, estado, tipo, color, comentario,
        fecha, hora,
        usuario: localStorage.getItem('rodeo_operador') || 'Admin',
        tiene_boton:    boton    ? 'si' : 'no',
        tiene_caravana: caravana ? 'si' : 'no',
      };

      const resp = await fetch('/api/actualizar-animal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      if (_onToast) _onToast('✓ Animal agregado al rodeo', 'exito', 3000);
      modal.remove();
      await cargarRodeoOficial();

    } catch (err) {
      if (_onToast) _onToast(`✗ Error: ${err.message}`, 'error', 4000);
      btn.disabled = false;
      btn.textContent = '💾 Agregar animal';
    }
  });
}

// ─── Lightbox — ver imagen completa ──────────────────────────────────────────
window.abrirLightbox = function(src) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lb || !img) return;
  img.src          = src;
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.cerrarLightbox = function() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.style.display = 'none';
  document.body.style.overflow = '';
};

// Cerrar lightbox con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.cerrarLightbox();
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatearFecha(str) {
  return str.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
}

