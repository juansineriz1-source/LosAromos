// ─── inseminaciones.js ──────────────────────────────────────────────────────

const GESTACION_DIAS = 283;

let _inseminacionesData = [];

// Parsea fechas en formato dd/mm/yyyy
function parseFechaAR(str) {
  if (!str) return null;
  const p = str.trim().split('/');
  if (p.length !== 3) return null;
  const d = new Date(+p[2], +p[1] - 1, +p[0]);
  return isNaN(d.getTime()) ? null : d;
}

function formatFechaAR(date) {
  if (!date) return '';
  return date.toLocaleDateString('es-AR');
}

export async function cargarInseminaciones() {
  try {
    const r = await fetch('/api/animales?modo=inseminaciones');
    const { inseminaciones } = await r.json();
    _inseminacionesData = inseminaciones || [];
  } catch(e) {
    console.warn('[inseminaciones] error cargando:', e);
    _inseminacionesData = [];
  }
}

export function getInseminacionesData() { return _inseminacionesData; }

// Devuelve el registro de inseminacion mas reciente de un animal (por boton o caravana)
export function getInseminacionAnimal(animal, data) {
  const d = data || _inseminacionesData;
  const registros = d.filter(i =>
    (i.boton    && animal.boton    && i.boton    === animal.boton) ||
    (i.caravana && animal.caravana && i.caravana === animal.caravana)
  ).filter(i => i.estado !== 'parida' && i.estado !== 'fallida');
  if (!registros.length) return null;
  // El mas reciente
  return registros.sort((a, b) => {
    const da = parseFechaAR(a.fecha_inseminacion);
    const db = parseFechaAR(b.fecha_inseminacion);
    return (db || 0) - (da || 0);
  })[0];
}

// Calcula datos de gestacion para un registro de inseminacion
export function calcularGestacion(inseminacion) {
  if (!inseminacion) return null;
  const fechaIns  = parseFechaAR(inseminacion.fecha_inseminacion);
  const fechaParto = parseFechaAR(inseminacion.fecha_parto_esperada)
    || (fechaIns ? new Date(fechaIns.getTime() + GESTACION_DIAS * 86400000) : null);
  if (!fechaIns) return null;

  const hoy        = new Date();
  const diasDesde  = Math.floor((hoy - fechaIns) / 86400000);
  const diasParaParto = fechaParto ? Math.floor((fechaParto - hoy) / 86400000) : null;
  const mesGestacion  = Math.floor(diasDesde / 30) + 1;
  const pct           = Math.min(100, Math.round((diasDesde / GESTACION_DIAS) * 100));

  return {
    fechaIns,
    fechaParto,
    diasDesde,
    diasParaParto,
    mesGestacion,
    pct,
    semen_toro:   inseminacion.semen_toro   || '',
    metodo:       inseminacion.metodo        || '',
    estado:       inseminacion.estado        || '',
    observaciones:inseminacion.observaciones || '',
    fecha_tacto:  inseminacion.fecha_tacto   || '',
  };
}

// Calcula las proximas vacunas preparto basadas en la fecha de inseminacion
export function alertasPrepartoAnimal(inseminacion) {
  if (!inseminacion) return [];
  const g = calcularGestacion(inseminacion);
  if (!g) return [];

  const { diasDesde, diasParaParto, fechaIns } = g;
  if (!fechaIns) return [];

  const alertas = [];
  const hoy = new Date();

  // Ventanas: [diaDesdeIns, label, vacuna, urgente si faltan <= X dias]
  const VENTANAS = [
    { diaMin: 200, diaMax: 220, vacuna: 'Diarrea Neonatal (1a dosis)',
      label: 'Diarrea Neonatal 1ª dosis (mes 7)', urgente: 10 },
    { diaMin: 230, diaMax: 250, vacuna: 'Diarrea Neonatal (2a dosis) + Clostridiales',
      label: 'Diarrea Neonatal 2ª + Clostridiales (mes 8)', urgente: 10 },
    { diaMin: 215, diaMax: 235, vacuna: 'Reproductivas (IBR+DVB+Lepto)',
      label: 'Reproductivas preparto (60d antes del parto)', urgente: 10 },
    { diaMin: 245, diaMax: 265, vacuna: 'Clostridiales (refuerzo final)',
      label: 'Clostridiales refuerzo (30d antes del parto)', urgente: 10 },
  ];

  VENTANAS.forEach(v => {
    const diasParaInicio = v.diaMin - diasDesde;
    const diasParaFin    = v.diaMax - diasDesde;

    if (diasParaFin < 0) {
      // Ya paso la ventana
      alertas.push({ ...v, nivel: 'pasada', diasParaInicio, diasParaFin,
        texto: `${v.label} — ventana pasada (dia ${diasDesde})` });
    } else if (diasParaInicio <= 0) {
      // ESTAMOS EN LA VENTANA — urgente!
      alertas.push({ ...v, nivel: 'urgente', diasParaInicio, diasParaFin,
        texto: `${v.label} — ¡VACUNAR AHORA! (quedan ${diasParaFin}d)` });
    } else if (diasParaInicio <= 30) {
      // Proximo — menos de 30 dias para entrar a la ventana
      alertas.push({ ...v, nivel: 'proximo', diasParaInicio, diasParaFin,
        texto: `${v.label} — en ${diasParaInicio}d` });
    }
    // Si falta mas de 30 dias, no alertar todavia
  });

  return alertas;
}

// Alertas globales de inseminacion para todo el rodeo
export function alertasInseminacionGlobales(animales, insData) {
  const d = insData || _inseminacionesData;
  const alertas = [];

  let enVentana  = 0;
  let proxParto  = 0; // paren en menos de 30 dias
  let atrasadas  = 0; // paren en menos de 7 dias (inminente)

  animales.forEach(a => {
    const ins = getInseminacionAnimal(a, d);
    if (!ins) return;
    const g = calcularGestacion(ins);
    if (!g) return;

    const vacs = alertasPrepartoAnimal(ins).filter(v => v.nivel === 'urgente');
    if (vacs.length) enVentana++;

    if (g.diasParaParto !== null) {
      if (g.diasParaParto <= 7)  atrasadas++;
      else if (g.diasParaParto <= 30) proxParto++;
    }
  });

  if (atrasadas > 0)  alertas.push({ nivel: 'rojo',    icono: '🔴', texto: `${atrasadas} vaca${atrasadas>1?'s':''} paren en menos de 7 días — INMINENTE`, tipo: 'parto' });
  if (proxParto > 0)  alertas.push({ nivel: 'naranja',  icono: '🟠', texto: `${proxParto} vaca${proxParto>1?'s':''} paren en los próximos 30 días`, tipo: 'parto' });
  if (enVentana > 0)  alertas.push({ nivel: 'naranja',  icono: '💉', texto: `${enVentana} gestante${enVentana>1?'s':''} en ventana de vacunación preparto`, tipo: 'vacuna' });

  return alertas;
}

export async function registrarInseminacion(datos, operador) {
  const body = { ...datos, modo: 'registro-inseminacion', operador };
  const r = await fetch('/api/animales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
