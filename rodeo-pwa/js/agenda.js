/**
 * js/agenda.js — Módulo de Agenda/Tareas
 *
 * Expone:
 *   initAgenda(esAdmin, operador)  — inicializa el tab
 *   cargarAgenda()                 — recarga las tareas desde el API
 */

let _esAdmin  = false;
let _operador = '';
let _tareas   = [];
let _filtroActivo = 'todos';

// ─── Inicializar ──────────────────────────────────────────────────────────────
export function initAgenda(esAdmin, operador) {
  _esAdmin  = esAdmin;
  _operador = operador;

  // Mostrar botón "Nueva" solo para admins
  const btnNueva = document.getElementById('btn-nueva-tarea');
  if (btnNueva) {
    btnNueva.style.display = esAdmin ? 'flex' : 'none';
    btnNueva.addEventListener('click', abrirModalNuevaTarea);
  }

  // Filtros
  document.querySelectorAll('.agenda-filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agenda-filtro-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      _filtroActivo = btn.dataset.filtro;
      renderizarTareas();
    });
  });
}

// ─── Cargar tareas desde API ──────────────────────────────────────────────────
export async function cargarAgenda() {
  const lista = document.getElementById('agenda-lista');
  if (!lista) return;
  lista.innerHTML = '<p class="sin-historial" style="margin:32px 0;">Cargando...</p>';

  try {
    // Admin ve todas; operario solo las suyas
    const qs   = _esAdmin ? '' : `?usuario=${encodeURIComponent(_operador)}`;
    const resp = await fetch(`/api/tareas${qs}`);
    const data = await resp.json();
    _tareas = data.tareas || [];
    renderizarTareas();
    actualizarResumen();
  } catch (err) {
    lista.innerHTML = `<p class="sin-historial" style="margin:32px 0;">Error al cargar: ${err.message}</p>`;
  }
}

// ─── Renderizar lista filtrada ────────────────────────────────────────────────
function renderizarTareas() {
  const lista = document.getElementById('agenda-lista');
  if (!lista) return;

  const filtradas = _filtroActivo === 'todos'
    ? _tareas
    : _tareas.filter(t => t.estado === _filtroActivo);

  if (!filtradas.length) {
    lista.innerHTML = `
      <div style="text-align:center;padding:48px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">${_filtroActivo === 'Completada' ? '✅' : '📋'}</div>
        <p style="color:var(--gris);font-size:15px;">
          ${_filtroActivo === 'Completada' ? 'Sin tareas completadas' :
            _filtroActivo === 'Pendiente'  ? 'Sin tareas pendientes 🎉' :
                                             'Sin tareas asignadas'}
        </p>
      </div>`;
    return;
  }

  lista.innerHTML = filtradas.map(t => tarjetaTarea(t)).join('');
}

// ─── Tarjeta de tarea ─────────────────────────────────────────────────────────
function tarjetaTarea(t) {
  const completada = t.estado === 'Completada';
  const PRIORIDAD_COLOR = { Alta: '#e74c3c', Media: '#f39c12', Baja: '#27ae60' };
  const color = PRIORIDAD_COLOR[t.prioridad] || '#888';

  return `
    <div class="agenda-card ${completada ? 'agenda-card-ok' : ''}" id="tarea-${t.id}">
      <div class="agenda-card-header">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
          <div class="agenda-prioridad-dot" style="background:${color};flex-shrink:0;"></div>
          <div class="agenda-card-titulo ${completada ? 'tarea-tachada' : ''}">${t.titulo}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span class="agenda-estado-badge ${completada ? 'badge-ok' : 'badge-pendiente'}">
            ${completada ? '✓ Listo' : '● Pendiente'}
          </span>
          ${_esAdmin ? `<button class="agenda-btn-eliminar" onclick="window._eliminarTarea('${t.id}')" title="Eliminar">✕</button>` : ''}
        </div>
      </div>

      ${t.descripcion ? `<div class="agenda-card-desc">${t.descripcion}</div>` : ''}

      <div class="agenda-card-meta">
        <span>👤 ${t.asignado_a}</span>
        ${_esAdmin && t.asignado_por ? `<span>· de ${t.asignado_por}</span>` : ''}
        <span>· ${t.fecha_creacion}</span>
        ${t.prioridad !== 'Media' ? `<span class="agenda-prioridad-label" style="color:${color}">· ${t.prioridad}</span>` : ''}
      </div>

      ${completada && t.fecha_completada ? `
        <div class="agenda-card-completada">
          ✓ Completada el ${t.fecha_completada}${t.comentario_completado ? ` — "${t.comentario_completado}"` : ''}
        </div>` : ''}

      ${!completada && (t.asignado_a.toLowerCase() === _operador.toLowerCase() || _esAdmin) ? `
        <button class="agenda-btn-completar" onclick="window._completarTarea('${t.id}')">
          ✓ Marcar completada
        </button>` : ''}
    </div>
  `;
}

// ─── Resumen en el subtítulo ──────────────────────────────────────────────────
function actualizarResumen() {
  const el = document.getElementById('agenda-resumen');
  if (!el) return;
  const pendientes  = _tareas.filter(t => t.estado === 'Pendiente').length;
  const completadas = _tareas.filter(t => t.estado === 'Completada').length;
  el.textContent = pendientes
    ? `${pendientes} pendiente${pendientes > 1 ? 's' : ''} · ${completadas} completada${completadas !== 1 ? 's' : ''}`
    : `Todo al día ✓ · ${completadas} tarea${completadas !== 1 ? 's' : ''} completada${completadas !== 1 ? 's' : ''}`;
}

// ─── Completar tarea ──────────────────────────────────────────────────────────
window._completarTarea = async function(id) {
  const tarea = _tareas.find(t => t.id === id);
  if (!tarea) return;

  // Pedir comentario opcional
  const existente = document.getElementById('modal-completar-tarea');
  if (existente) existente.remove();

  const dlg = document.createElement('div');
  dlg.id = 'modal-completar-tarea';
  dlg.className = 'modal-overlay';
  dlg.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0;padding:0;max-width:400px;margin:auto;position:fixed;bottom:0;left:0;right:0;">
      <div style="display:flex;justify-content:center;padding:10px 0 4px;">
        <div style="width:40px;height:4px;border-radius:99px;background:rgba(0,0,0,.15);"></div>
      </div>
      <div style="padding:16px 20px 32px;">
        <div style="font-size:17px;font-weight:800;margin-bottom:4px;">✓ Completar tarea</div>
        <div style="font-size:13px;color:var(--gris);margin-bottom:16px;">${tarea.titulo}</div>
        <label style="font-size:12px;font-weight:700;color:var(--texto-secundario);display:block;margin-bottom:6px;">COMENTARIO (opcional)</label>
        <input id="completar-comentario" type="text" placeholder="¿Alguna observación?"
               style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--borde);font-size:15px;box-sizing:border-box;margin-bottom:14px;">
        <button id="btn-confirmar-completar"
                style="width:100%;padding:14px;background:var(--verde-oscuro);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
          ✓ Confirmar
        </button>
        <button onclick="document.getElementById('modal-completar-tarea').remove()"
                style="width:100%;padding:10px;background:none;border:none;color:var(--gris);font-size:14px;margin-top:6px;cursor:pointer;">
          Cancelar
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  document.getElementById('completar-comentario').focus();

  document.getElementById('btn-confirmar-completar').addEventListener('click', async () => {
    const comentario = document.getElementById('completar-comentario').value.trim();
    const btn = document.getElementById('btn-confirmar-completar');
    btn.textContent = 'Guardando...';
    btn.disabled    = true;

    try {
      const resp = await fetch('/api/tareas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'completar', id, comentario, usuario: _operador }),
      });
      const data = await resp.json();
      if (data.ok) {
        dlg.remove();
        await cargarAgenda();
      } else {
        btn.textContent = '✓ Confirmar';
        btn.disabled = false;
        alert('Error: ' + data.error);
      }
    } catch (err) {
      btn.textContent = '✓ Confirmar';
      btn.disabled = false;
      alert('Error de red: ' + err.message);
    }
  });
};

// ─── Eliminar tarea (solo admin) ──────────────────────────────────────────────
window._eliminarTarea = async function(id) {
  if (!_esAdmin) return;
  if (!confirm('¿Eliminar esta tarea?')) return;

  try {
    const resp = await fetch('/api/tareas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo: 'eliminar', id }),
    });
    const data = await resp.json();
    if (data.ok) await cargarAgenda();
    else alert('Error: ' + data.error);
  } catch (err) {
    alert('Error de red: ' + err.message);
  }
};

// ─── Modal nueva tarea (admin) ────────────────────────────────────────────────
function abrirModalNuevaTarea() {
  const existente = document.getElementById('modal-nueva-tarea');
  if (existente) existente.remove();

  // Obtener lista de operadores conocidos de las tareas existentes + el admin
  const usuariosConocidos = [...new Set([
    _operador,
    ..._tareas.map(t => t.asignado_a).filter(Boolean),
  ])].sort();

  const dlg = document.createElement('div');
  dlg.id = 'modal-nueva-tarea';
  dlg.className = 'modal-overlay';
  dlg.innerHTML = `
    <div class="modal" style="border-radius:24px 24px 0 0;padding:0;position:fixed;bottom:0;left:0;right:0;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:center;padding:10px 0 4px;position:sticky;top:0;background:var(--bg-card);">
        <div style="width:40px;height:4px;border-radius:99px;background:rgba(0,0,0,.15);"></div>
      </div>
      <div style="padding:0 20px 32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-size:17px;font-weight:800;">📋 Nueva tarea</div>
          <button onclick="document.getElementById('modal-nueva-tarea').remove()"
                  style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gris);">✕</button>
        </div>

        <label class="campo-label">TÍTULO *</label>
        <input id="nueva-titulo" class="campo-input" placeholder="Ej: Revisar el potrero norte..." autocomplete="off" style="margin-bottom:14px;">

        <label class="campo-label">DESCRIPCIÓN</label>
        <textarea id="nueva-descripcion" class="campo-input" rows="3"
                  placeholder="Detalles adicionales..."
                  style="resize:vertical;margin-bottom:14px;"></textarea>

        <label class="campo-label">ASIGNAR A *</label>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <input id="nueva-asignado" class="campo-input" placeholder="Nombre del operario..." autocomplete="off" list="lista-operadores" style="flex:1;">
          <datalist id="lista-operadores">
            ${usuariosConocidos.map(u => `<option value="${u}">`).join('')}
          </datalist>
        </div>

        <label class="campo-label">PRIORIDAD</label>
        <div class="rodeo-edit-opciones" style="margin-bottom:20px;">
          <button class="rodeo-edit-chip" data-prioridad="Alta" onclick="seleccionarPrioridad(this)">🔴 Alta</button>
          <button class="rodeo-edit-chip activo" data-prioridad="Media" onclick="seleccionarPrioridad(this)">🟡 Media</button>
          <button class="rodeo-edit-chip" data-prioridad="Baja" onclick="seleccionarPrioridad(this)">🟢 Baja</button>
        </div>
        <input type="hidden" id="nueva-prioridad" value="Media">

        <button id="btn-guardar-tarea"
                style="width:100%;padding:14px;background:var(--verde-oscuro);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
          + Crear tarea
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  document.getElementById('nueva-titulo').focus();

  document.getElementById('btn-guardar-tarea').addEventListener('click', async () => {
    const titulo      = document.getElementById('nueva-titulo').value.trim();
    const descripcion = document.getElementById('nueva-descripcion').value.trim();
    const asignado_a  = document.getElementById('nueva-asignado').value.trim();
    const prioridad   = document.getElementById('nueva-prioridad').value;

    if (!titulo)      { alert('Ingresá un título'); return; }
    if (!asignado_a)  { alert('Ingresá a quién asignar la tarea'); return; }

    const btn = document.getElementById('btn-guardar-tarea');
    btn.textContent = 'Guardando...';
    btn.disabled    = true;

    try {
      const resp = await fetch('/api/tareas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'nueva', titulo, descripcion, asignado_a,
          asignado_por: _operador, prioridad,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        dlg.remove();
        await cargarAgenda();
      } else {
        btn.textContent = '+ Crear tarea';
        btn.disabled    = false;
        alert('Error: ' + data.error);
      }
    } catch (err) {
      btn.textContent = '+ Crear tarea';
      btn.disabled    = false;
      alert('Error de red: ' + err.message);
    }
  });
}

// Helper: seleccionar prioridad
window.seleccionarPrioridad = function(btn) {
  btn.closest('.rodeo-edit-opciones').querySelectorAll('.rodeo-edit-chip').forEach(b => b.classList.remove('activo'));
  btn.classList.add('activo');
  document.getElementById('nueva-prioridad').value = btn.dataset.prioridad;
};
