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
let _filtroTipo = 'todos'; // chip de filtro activo en Rodeo

// ─── Opciones de campo (actualizadas) ────────────────────────────────────────
const ESTADOS = ['P', 'V', 'I'];
const ETIQUETAS_ESTADO = {
  P: 'Preñada', V: 'Vacía', I: 'Inseminada',
};

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
  const conteoTotal = {};
  _animales.forEach(a => { conteoTotal[a.tipo] = (conteoTotal[a.tipo] || 0) + 1; });
  const statsHtml = Object.entries(conteoTotal)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="rodeo-stat-chip">${t} <b>${n}</b></span>`)
    .join('');

  if (resumen) {
    resumen.innerHTML = `
      <span class="rodeo-stat-total">${total} animales</span>
      ${statsHtml}
    `;
  }

  // Actualizar chips de filtro
  actualizarChipsFiltro();

  if (!animales.length) {
    contenedor.innerHTML = '<p class="sin-historial">Sin animales en este filtro</p>';
    return;
  }

  contenedor.innerHTML = animales.map((a, i) => {
    const estadoClass = (a.estado || '').toLowerCase().replace(' ', '-');
    const tipoClass   = (a.tipo   || '').toLowerCase().replace(' ', '-');
    const colorDot    = a.color === 'Negra' ? '⚫' : a.color === 'Colorada' ? '🟠' : '';

    return `
      <div class="rodeo-of-item rodeo-of-item-tap" data-idx="${i}" onclick="abrirDetalleAnimal(${i})">
        <div class="rodeo-of-ids">
          <div class="rodeo-of-ids-row">
            ${a.boton    ? `<span class="rodeo-of-boton">🔖 ${a.boton}</span>`    : ''}
            ${a.caravana ? `<span class="rodeo-of-caravana">🏷 ${a.caravana}</span>` : ''}
          </div>
          <div class="rodeo-of-badges-row">
            <span class="rodeo-of-tipo  rodeo-tipo-${tipoClass}">${a.tipo   || '—'}</span>
            <span class="rodeo-of-estado rodeo-estado-${estadoClass}">${a.estado || '—'}${a.estado ? ` · ${ETIQUETAS_ESTADO[a.estado] || ''}` : ''}</span>
            ${colorDot ? `<span class="rodeo-of-color">${colorDot} ${a.color}</span>` : ''}
          </div>
        </div>
        ${_esAdmin ? `<button class="rodeo-of-btn-editar" onclick="event.stopPropagation(); abrirEditorAnimal(${i})">✏️</button>` : '<span class="rodeo-of-chevron">›</span>'}
      </div>
    `;
  }).join('');
}

// ─── Chips de filtro por tipo ─────────────────────────────────────────────────
function actualizarChipsFiltro() {
  const barra = document.getElementById('rodeo-filtros-chips');
  if (!barra) return;

  const conteo = {};
  _animales.forEach(a => { if (a.tipo) conteo[a.tipo] = (conteo[a.tipo] || 0) + 1; });
  const tiposOrdenados = Object.entries(conteo).sort((a, b) => b[1] - a[1]).map(([t]) => t);

  barra.innerHTML = [
    `<button class="rodeo-filtro-chip${_filtroTipo === 'todos' ? ' activo' : ''}" data-filtro="todos">Todos <b>${_animales.length}</b></button>`,
    ...tiposOrdenados.map(t =>
      `<button class="rodeo-filtro-chip${_filtroTipo === t ? ' activo' : ''}" data-filtro="${t}">${t} <b>${conteo[t]}</b></button>`
    ),
  ].join('');

  barra.querySelectorAll('.rodeo-filtro-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _filtroTipo = btn.dataset.filtro;
      aplicarFiltros();
    });
  });
}

function aplicarFiltros() {
  const texto = (document.getElementById('rodeo-of-buscar')?.value || '').toLowerCase().trim();
  let filtrados = _animales;
  if (_filtroTipo !== 'todos') {
    filtrados = filtrados.filter(a => (a.tipo || '') === _filtroTipo);
  }
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

        <!-- Estado: P / V / I -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Estado</div>
          <div class="rodeo-edit-opciones">
            ${ESTADOS.map(e => `
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
    boton:          document.getElementById('edit-boton').value.trim(),
    caravana:       document.getElementById('edit-caravana').value.trim(),
    estado:         document.getElementById('edit-estado').value,
    tiene_caravana: document.getElementById('edit-tiene-caravana').value,
    tiene_boton:    document.getElementById('edit-tiene-boton').value,
    tipo:           document.getElementById('edit-tipo').value,
    color:          document.getElementById('edit-color').value,
    comentario:     document.getElementById('edit-comentario').value.trim(),
    usuario:        localStorage.getItem('rodeo_operador') || 'Admin',
    // Historial columnas L-O
    boton_viejo:    animal_viejo.boton,
    caravana_vieja: animal_viejo.caravana,
    estado_viejo:   animal_viejo.estado,
    tipo_viejo:     animal_viejo.tipo,
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
        boton, caravana, estado, tipo, color, comentario,
        fecha, hora,
        operador: localStorage.getItem('rodeo_operador') || 'Admin',
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

