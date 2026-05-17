/**
 * rodeo-oficial.js — Módulo de lectura y edición del rodeo oficial (Google Sheets)
 *
 * Para ADMINS: permite editar Botón, Caravana, Estado, TIPO y demás campos.
 * Cada edición agrega una nueva fila en Sheets (trazabilidad histórica).
 *
 * Para OPERARIOS: solo lectura.
 */

// ─── Estado ───────────────────────────────────────────────────────────────────
let _animales = [];
let _onToast  = null;
let _esAdmin  = false;

// Opciones de estado y tipo del campo
const ESTADOS = ['P', 'V', 'D', 'B', 'S', 'G', 'AG'];
const ETIQUETAS_ESTADO = {
  P: 'P — Preñada', V: 'V — Vacía', D: 'D — Dudosa',
  B: 'B — Baja', S: 'S — Sin dato', G: 'G — Gestando', AG: 'AG — A gestación',
};
const TIPOS = ['V', 'V1', 'VA', 'VQ', 'VV', 'T', 'TN', 'VN'];
const ETIQUETAS_TIPO = {
  V: 'V — Vaca', V1: 'V1 — 1.ª parición', VA: 'VA — Vaca adulta',
  VQ: 'VQ — Vaquillona', VV: 'VV — Vaca vieja', T: 'T — Toro',
  TN: 'TN — Ternero/a', VN: 'VN — Vientre no id.',
};

// ─── Init ─────────────────────────────────────────────────────────────────────
export function inicializarRodeoOficial(onToast, esAdmin) {
  _onToast = onToast;
  _esAdmin = esAdmin;
}

// ─── Cargar desde Sheets ──────────────────────────────────────────────────────
export async function cargarRodeoOficial() {
  const contenedor = document.getElementById('rodeo-oficial-lista');
  const resumen    = document.getElementById('rodeo-oficial-resumen');
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

  // Stats rápidos
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

  contenedor.innerHTML = animales.map((a, i) => `
    <div class="rodeo-of-item" data-idx="${i}">
      <div class="rodeo-of-ids">
        <span class="rodeo-of-boton">${a.boton || '—'}</span>
        <span class="rodeo-of-caravana">${a.caravana ? `🏷 ${a.caravana}` : ''}</span>
      </div>
      <div class="rodeo-of-info">
        <span class="rodeo-of-tipo rodeo-tipo-${(a.tipo || '').toLowerCase()}">${a.tipo || '—'}</span>
        <span class="rodeo-of-estado rodeo-estado-${(a.estado || '').toLowerCase()}">${a.estado || '—'}</span>
        ${a.tiene_caravana === 'SI' ? '<span class="rodeo-of-badge">🏷 Car</span>' : '<span class="rodeo-of-badge rodeo-badge-no">Sin car</span>'}
        ${a.tiene_boton   === 'SI' ? '<span class="rodeo-of-badge">📟 Bot</span>' : '<span class="rodeo-of-badge rodeo-badge-no">Sin bot</span>'}
      </div>
      <div class="rodeo-of-fecha">${a.fecha ? formatearFecha(a.fecha) : ''}</div>
      ${_esAdmin ? `<button class="rodeo-of-btn-editar" onclick="abrirEditorAnimal(${i})">✏️</button>` : ''}
    </div>
  `).join('');
}

// ─── Abrir modal de edición ───────────────────────────────────────────────────
window.abrirEditorAnimal = function(idx) {
  const a = _animales[idx];
  if (!a || !_esAdmin) return;

  // Limpiar modal anterior
  const existente = document.getElementById('modal-editor-animal');
  if (existente) existente.remove();

  const modal = document.createElement('div');
  modal.id        = 'modal-editor-animal';
  modal.className = 'modal-overlay';

  modal.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0; padding: 0 0 32px;">
      <div class="modal-header">
        <div>
          <div class="modal-caravana">${a.boton || a.caravana}</div>
          <div style="font-size:12px;color:var(--gris);margin-top:2px">Editar animal</div>
        </div>
        <button class="modal-cerrar" id="modal-animal-cerrar">✕</button>
      </div>

      <div class="modal-body">

        <!-- IDs -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">🔖 Botón</div>
          <input class="campo-input" id="edit-boton" value="${a.boton}" placeholder="Ej: DG687 E627">
        </div>
        <div class="rodeo-edit-seccion">
          <div class="campo-label">🏷 Caravana</div>
          <input class="campo-input" id="edit-caravana" value="${a.caravana}" placeholder="Ej: E627">
        </div>

        <!-- Estado -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Estado</div>
          <div class="rodeo-edit-opciones">
            ${ESTADOS.map(e => `
              <button class="rodeo-edit-chip ${a.estado === e ? 'activo' : ''}"
                onclick="seleccionarEstado('${e}', this)"
                data-valor="${e}">
                ${e}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="edit-estado" value="${a.estado}">
        </div>

        <!-- TIPO -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Tipo</div>
          <div class="rodeo-edit-opciones">
            ${TIPOS.map(t => `
              <button class="rodeo-edit-chip ${a.tipo === t ? 'activo' : ''}"
                onclick="seleccionarTipo('${t}', this)"
                data-valor="${t}">
                ${t}
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="edit-tipo" value="${a.tipo}">
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

        <!-- Color -->
        <div class="rodeo-edit-seccion">
          <div class="campo-label">Color</div>
          <input class="campo-input" id="edit-color" value="${a.color}" placeholder="Ej: Negro, Colorado...">
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

        <!-- Historial compacto -->
        ${a.boton_viejo ? `
          <div style="margin-top:12px;padding:10px 12px;background:var(--gris-claro);border-radius:var(--radio);font-size:12px;color:var(--gris)">
            <b>Cambio anterior:</b> ${a.boton_viejo} / ${a.caravana_vieja} — ${a.estado_viejo} / ${a.tipo_viejo}
          </div>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Cerrar
  const cerrar = () => modal.remove();
  document.getElementById('modal-animal-cerrar').addEventListener('click', cerrar);
  modal.addEventListener('click', e => { if (e.target === modal) cerrar(); });

  // Guardar
  document.getElementById('btn-guardar-animal').addEventListener('click', async () => {
    await guardarEdicionAnimal(a, cerrar);
  });
};

// ─── Helpers de selección en el modal ────────────────────────────────────────
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

window.toggleSiNo = function(inputId, btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById(inputId).value = btn.dataset.valor;
};

// ─── Enviar edición al servidor ───────────────────────────────────────────────
async function guardarEdicionAnimal(animal_viejo, cerrarModal) {
  const btn = document.getElementById('btn-guardar-animal');
  btn.disabled     = true;
  btn.textContent  = '⏳ Guardando...';

  const payload = {
    // Nuevos valores
    boton:          document.getElementById('edit-boton').value.trim(),
    caravana:       document.getElementById('edit-caravana').value.trim(),
    estado:         document.getElementById('edit-estado').value,
    tiene_caravana: document.getElementById('edit-tiene-caravana').value,
    tiene_boton:    document.getElementById('edit-tiene-boton').value,
    tipo:           document.getElementById('edit-tipo').value,
    color:          document.getElementById('edit-color').value.trim(),
    comentario:     document.getElementById('edit-comentario').value.trim(),
    usuario:        localStorage.getItem('rodeo_operador') || 'Admin',
    // Valores anteriores para columnas L-O
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
    const result = await resp.json();

    if (_onToast) _onToast(`✓ ${payload.boton || payload.caravana} actualizado`, 'exito', 3000);
    cerrarModal();

    // Recargar lista
    await cargarRodeoOficial();

  } catch (err) {
    if (_onToast) _onToast(`✗ Error al guardar: ${err.message}`, 'error', 4000);
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
  // str puede ser "27/03/2026" o "2026-03-27"
  return str.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
}
