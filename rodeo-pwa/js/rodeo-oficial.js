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
let _animales = [];
let _onToast  = null;
let _esAdmin  = false;

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

  // Stats rápidos por tipo
  const tipos = {};
  animales.forEach(a => { tipos[a.tipo] = (tipos[a.tipo] || 0) + 1; });
  const statsHtml = Object.entries(tipos)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="rodeo-stat-chip">${t} <b>${n}</b></span>`)
    .join('');

  if (resumen) {
    resumen.innerHTML = `
      <span class="rodeo-stat-total">${total} animales</span>
      ${statsHtml}
    `;
  }

  if (!animales.length) {
    contenedor.innerHTML = '<p class="sin-historial">Sin animales en el rodeo</p>';
    return;
  }

  contenedor.innerHTML = animales.map((a, i) => {
    const estadoClass = (a.estado || '').toLowerCase().replace(' ', '-');
    const tipoClass   = (a.tipo   || '').toLowerCase().replace(' ', '-');
    const colorDot    = a.color === 'Negra' ? '⚫' : a.color === 'Colorada' ? '🟠' : '';

    return `
      <div class="rodeo-of-item" data-idx="${i}">
        <!-- IDs: Botón y Caravana visibles en móvil -->
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
        ${_esAdmin ? `<button class="rodeo-of-btn-editar" onclick="abrirEditorAnimal(${i})">✏️</button>` : ''}
      </div>
    `;
  }).join('');
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

// ─── Filtro de búsqueda ───────────────────────────────────────────────────────
export function filtrarRodeo(texto) {
  const q = (texto || '').toLowerCase().trim();
  if (!q) {
    renderizarRodeo(_animales, _animales.length);
    return;
  }
  const filtrados = _animales.filter(a =>
    (a.boton     || '').toLowerCase().includes(q) ||
    (a.caravana  || '').toLowerCase().includes(q) ||
    (a.tipo      || '').toLowerCase().includes(q) ||
    (a.estado    || '').toLowerCase().includes(q) ||
    (a.color     || '').toLowerCase().includes(q) ||
    (a.comentario|| '').toLowerCase().includes(q)
  );
  renderizarRodeo(filtrados, _animales.length);
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatearFecha(str) {
  return str.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
}
