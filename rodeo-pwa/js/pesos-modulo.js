// ─── pesos-modulo.js — Módulo de registro de pesadas ─────────────────────────
// Gestiona el panel de Pesadas con 2 modos:
//   A) Animal individual
//   B) Pesada grupal (total ÷ cantidad → mismo kg para cada animal)

let _pesosAnimales = []; // referencia al array global de animales

export function initPesosModulo(animalesRef) {
  _pesosAnimales = animalesRef;
  _initEventos();
}

// ─── Actualizar referencia a animales ────────────────────────────────────────
export function setPesosAnimales(animalesRef) {
  _pesosAnimales = animalesRef;
}

// ─── Inicializar eventos del panel ───────────────────────────────────────────
function _initEventos() {
  const btnAbrir   = document.getElementById('btn-abrir-pesadas');
  const btnCerrar  = document.getElementById('btn-cerrar-pesadas');
  const panel      = document.getElementById('panel-pesadas');

  if (btnAbrir)  btnAbrir.addEventListener('click',  () => abrirPanelPesadas());
  if (btnCerrar) btnCerrar.addEventListener('click', () => cerrarPanelPesadas());

  // Tabs Individual / Grupal
  document.getElementById('tab-peso-individual')?.addEventListener('click', () => _mostrarTab('individual'));
  document.getElementById('tab-peso-grupal')?.addEventListener('click',     () => _mostrarTab('grupal'));

  // ── Individual ──────────────────────────────────────────────────────────────
  const inputBuscar = document.getElementById('peso-ind-buscar');
  if (inputBuscar) {
    inputBuscar.addEventListener('input', () => _buscarAnimalPeso(inputBuscar.value));
  }
  document.getElementById('btn-guardar-peso-ind')?.addEventListener('click', _guardarPesoIndividual);

  // ── Grupal ──────────────────────────────────────────────────────────────────
  const inputTotal   = document.getElementById('peso-grup-total');
  const inputCantBtns = document.querySelectorAll('.peso-grup-cant-btn');

  inputTotal?.addEventListener('input', _recalcularPesoGrupal);
  inputCantBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      inputCantBtns.forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      _cantidadGrupal = parseInt(btn.dataset.n);
      document.getElementById('peso-grup-cant-manual').value = '';
      _recalcularPesoGrupal();
    });
  });

  document.getElementById('peso-grup-cant-manual')?.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v > 0) {
      _cantidadGrupal = v;
      inputCantBtns.forEach(b => b.classList.remove('activo'));
      _recalcularPesoGrupal();
    }
  });

  document.getElementById('peso-grup-buscar')?.addEventListener('input', e => _buscarAnimalGrupal(e.target.value));
  document.getElementById('btn-guardar-peso-grup')?.addEventListener('click', _guardarPesoGrupal);
}

// ─── Estado del módulo ───────────────────────────────────────────────────────
let _animalSeleccionado = null;   // para modo individual
let _grupoAnimales      = [];     // lista de animales en la pesada grupal
let _cantidadGrupal     = 2;      // cantidad de animales en la balanza

// ─── Abrir / Cerrar panel ────────────────────────────────────────────────────
export function abrirPanelPesadas() {
  // Cerrar otros paneles
  document.getElementById('panel-vacunacion')?.classList.add('oculto');
  document.getElementById('panel-inseminacion')?.classList.add('oculto');

  const panel = document.getElementById('panel-pesadas');
  panel?.classList.remove('oculto');

  // Resetear estado
  _animalSeleccionado = null;
  _grupoAnimales      = [];
  _cantidadGrupal     = 2;
  _mostrarTab('individual');
  _resetFormIndividual();
  _resetFormGrupal();
}

export function cerrarPanelPesadas() {
  document.getElementById('panel-pesadas')?.classList.add('oculto');
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
function _mostrarTab(tab) {
  const ind  = document.getElementById('pane-peso-individual');
  const grup = document.getElementById('pane-peso-grupal');
  const tInd  = document.getElementById('tab-peso-individual');
  const tGrup = document.getElementById('tab-peso-grupal');

  if (tab === 'individual') {
    ind?.classList.remove('oculto');
    grup?.classList.add('oculto');
    tInd?.classList.add('activo');
    tGrup?.classList.remove('activo');
  } else {
    ind?.classList.add('oculto');
    grup?.classList.remove('oculto');
    tInd?.classList.remove('activo');
    tGrup?.classList.add('activo');
  }
}

// ─── MODO A: Individual ───────────────────────────────────────────────────────
function _buscarAnimalPeso(query) {
  const res = document.getElementById('peso-ind-resultado');
  if (!query.trim()) { res.innerHTML = ''; _animalSeleccionado = null; return; }
  const q = query.trim().toLowerCase();
  const encontrado = _pesosAnimales.find(a =>
    (a.caravana || '').toLowerCase().includes(q) ||
    (a.boton    || '').toLowerCase().includes(q)
  );
  if (encontrado) {
    _animalSeleccionado = encontrado;
    res.innerHTML = `
      <div class="peso-animal-card seleccionado">
        <span class="peso-animal-id">${encontrado.boton || '—'}</span>
        <span class="peso-animal-car">Caravana ${encontrado.caravana || '—'}</span>
        <span class="peso-animal-tipo tipo-chip tipo-${(encontrado.tipo||'').toLowerCase()}">${encontrado.tipo || '?'}</span>
      </div>`;
  } else {
    _animalSeleccionado = null;
    res.innerHTML = `<p class="peso-no-result">No se encontró "${query}"</p>`;
  }
}

function _resetFormIndividual() {
  const f = document.getElementById('peso-ind-buscar');
  const k = document.getElementById('peso-ind-kg');
  const o = document.getElementById('peso-ind-obs');
  const r = document.getElementById('peso-ind-resultado');
  if (f) f.value = '';
  if (k) k.value = '';
  if (o) o.value = '';
  if (r) r.innerHTML = '';
  _animalSeleccionado = null;

  const hoy = new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric'
  });
  const fd = document.getElementById('peso-ind-fecha');
  if (fd) fd.value = new Date().toISOString().split('T')[0];
}

async function _guardarPesoIndividual() {
  if (!_animalSeleccionado) {
    _toast('Primero buscá y seleccioná un animal'); return;
  }
  const kg  = parseFloat(document.getElementById('peso-ind-kg').value);
  const obs = document.getElementById('peso-ind-obs').value.trim();
  const fechaISO = document.getElementById('peso-ind-fecha').value;

  if (!kg || kg <= 0 || kg > 1500) { _toast('Ingresá un peso válido (1–1500 kg)'); return; }

  const btn = document.getElementById('btn-guardar-peso-ind');
  btn.textContent = 'Guardando...';
  btn.disabled = true;

  try {
    const fechaAR = fechaISO
      ? fechaISO.split('-').reverse().join('/')
      : new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });

    const operador = localStorage.getItem('rodeo_operador') || 'sistema';
    const resp = await fetch('/api/pesos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caravana:      _animalSeleccionado.caravana || '',
        boton:         _animalSeleccionado.boton    || '',
        tipo:          _animalSeleccionado.tipo      || '',
        fecha:         fechaAR,
        peso_kg:       kg,
        observaciones: obs,
        operador,
      }),
    });
    const data = await resp.json();
    if (data.ok) {
      _toast(`✅ ${_animalSeleccionado.caravana || _animalSeleccionado.boton} — ${kg} kg guardado`);
      _resetFormIndividual();
    } else {
      _toast('Error al guardar: ' + (data.error || 'desconocido'));
    }
  } catch(e) {
    _toast('Error de red — intentá de nuevo');
  } finally {
    btn.textContent = '💾 Guardar peso';
    btn.disabled = false;
  }
}

// ─── MODO B: Grupal ───────────────────────────────────────────────────────────
function _buscarAnimalGrupal(query) {
  const lista = document.getElementById('peso-grup-resultados');
  if (!query.trim()) { lista.innerHTML = ''; return; }
  const q = query.trim().toLowerCase();
  const resultados = _pesosAnimales
    .filter(a =>
      ((a.caravana || '').toLowerCase().includes(q) || (a.boton || '').toLowerCase().includes(q)) &&
      !_grupoAnimales.find(g => g.boton === a.boton && g.caravana === a.caravana)
    )
    .slice(0, 6);

  if (!resultados.length) { lista.innerHTML = `<p class="peso-no-result">No se encontró "${query}"</p>`; return; }

  lista.innerHTML = resultados.map(a => `
    <div class="peso-grup-sugerencia" onclick="window._agregarAnimalGrupo('${a.boton?.replace(/'/g,"\\'")}','${a.caravana?.replace(/'/g,"\\'")}')">
      <span>${a.boton || '—'}</span>
      <span class="peso-animal-car">Car. ${a.caravana || '—'}</span>
      <span class="tipo-chip tipo-${(a.tipo||'').toLowerCase()}">${a.tipo || '?'}</span>
    </div>`).join('');
}

window._agregarAnimalGrupo = function(boton, caravana) {
  const animal = _pesosAnimales.find(a => a.boton === boton && a.caravana === caravana)
               || _pesosAnimales.find(a => a.boton === boton)
               || _pesosAnimales.find(a => a.caravana === caravana);
  if (!animal) return;
  if (_grupoAnimales.find(g => g.boton === animal.boton && g.caravana === animal.caravana)) return;
  _grupoAnimales.push(animal);
  document.getElementById('peso-grup-buscar').value = '';
  document.getElementById('peso-grup-resultados').innerHTML = '';
  _renderGrupo();
  _recalcularPesoGrupal();
};

window._quitarAnimalGrupo = function(idx) {
  _grupoAnimales.splice(idx, 1);
  _renderGrupo();
  _recalcularPesoGrupal();
};

function _renderGrupo() {
  const contenedor = document.getElementById('peso-grup-lista');
  if (!_grupoAnimales.length) {
    contenedor.innerHTML = `<p class="peso-grup-empty">Todavía no agregaste animales</p>`;
    return;
  }
  contenedor.innerHTML = _grupoAnimales.map((a, i) => `
    <div class="peso-grup-item">
      <span class="peso-grup-item-num">${i+1}</span>
      <div class="peso-grup-item-info">
        <strong>${a.boton || '—'}</strong>
        <span>Car. ${a.caravana || '—'} · ${a.tipo || '?'}</span>
      </div>
      <button class="peso-grup-item-quitar" onclick="window._quitarAnimalGrupo(${i})">✕</button>
    </div>`).join('');
}

function _recalcularPesoGrupal() {
  const total = parseFloat(document.getElementById('peso-grup-total').value) || 0;
  const cant  = _cantidadGrupal || _grupoAnimales.length || 1;
  const por   = cant > 0 && total > 0 ? Math.round((total / cant) * 10) / 10 : 0;

  const el = document.getElementById('peso-grup-por-animal');
  if (el) el.textContent = por > 0 ? `${por} kg por animal` : '—';

  // Actualizar contador de animales en el grupo
  const badge = document.getElementById('peso-grup-badge');
  if (badge) badge.textContent = _grupoAnimales.length || '0';
}

function _resetFormGrupal() {
  _grupoAnimales  = [];
  _cantidadGrupal = 2;
  const t = document.getElementById('peso-grup-total');
  const o = document.getElementById('peso-grup-obs');
  const b = document.getElementById('peso-grup-buscar');
  const r = document.getElementById('peso-grup-resultados');
  if (t) t.value = '';
  if (o) o.value = '';
  if (b) b.value = '';
  if (r) r.innerHTML = '';

  const fd = document.getElementById('peso-grup-fecha');
  if (fd) fd.value = new Date().toISOString().split('T')[0];

  _renderGrupo();
  _recalcularPesoGrupal();

  // Botones de cantidad — activar el de 2
  document.querySelectorAll('.peso-grup-cant-btn').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.n === '2');
  });
  const manual = document.getElementById('peso-grup-cant-manual');
  if (manual) manual.value = '';
}

async function _guardarPesoGrupal() {
  const total   = parseFloat(document.getElementById('peso-grup-total').value);
  const obs     = document.getElementById('peso-grup-obs').value.trim();
  const fechaISO= document.getElementById('peso-grup-fecha').value;

  if (!total || total <= 0 || total > 50000) { _toast('Ingresá un peso total válido'); return; }
  if (!_grupoAnimales.length) { _toast('Agregá al menos un animal al grupo'); return; }

  const cant = _cantidadGrupal || _grupoAnimales.length;
  if (cant <= 0) { _toast('La cantidad debe ser mayor a 0'); return; }

  const pesoIndividual = Math.round((total / cant) * 10) / 10;
  const fechaAR = fechaISO
    ? fechaISO.split('-').reverse().join('/')
    : new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });

  const operador = localStorage.getItem('rodeo_operador') || 'sistema';

  const btn = document.getElementById('btn-guardar-peso-grup');
  btn.textContent = 'Guardando...';
  btn.disabled = true;

  let ok = 0, errores = 0;
  for (const animal of _grupoAnimales) {
    try {
      const resp = await fetch('/api/pesos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caravana:      animal.caravana || '',
          boton:         animal.boton    || '',
          tipo:          animal.tipo     || '',
          fecha:         fechaAR,
          peso_kg:       pesoIndividual,
          observaciones: obs ? `[Grupal ${_grupoAnimales.length} animales, total ${total}kg] ${obs}` : `Pesada grupal — ${_grupoAnimales.length} animales, total ${total} kg`,
          operador,
        }),
      });
      const data = await resp.json();
      if (data.ok) ok++; else errores++;
    } catch { errores++; }
  }

  if (ok > 0) {
    _toast(`✅ ${ok} animal${ok > 1 ? 'es' : ''} registrados — ${pesoIndividual} kg c/u`);
    _resetFormGrupal();
  } else {
    _toast(`Error al guardar — ${errores} fallos`);
  }

  btn.textContent = '💾 Guardar pesada grupal';
  btn.disabled = false;
}

// ─── Helper toast ─────────────────────────────────────────────────────────────
function _toast(msg) {
  if (typeof mostrarToast === 'function') mostrarToast(msg);
  else console.log('[pesos]', msg);
}
