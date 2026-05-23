// ─── vacunas.js — Módulo de gestión de vacunación ────────────────────────────

// Cache de datos
let _vacunasData = []; // registros de la hoja Vacunacion

// Vacunas anuales — cuántos días de vigencia
const VIGENCIA_DIAS = {
  'Aftosa (Campana 1)':                       365,
  'Aftosa (Campana 2)':                       365,
  'Carbunclo Bacteridiano (Antrax)':          365,
  'Clostridiales':                            365,
  'Diarrea Neonatal (Preparto - a la madre)': 365,
  'Reproductivas (IBR+DVB+Lepto+Campy)':     365,
  'Queratoconjuntivitis':                     365,
  'Tristeza Bovina':                          365,
};

// Vacunas que aplican por categoría
const VAC_POR_CATEGORIA = {
  Ternero:    ['Aftosa (Campana 1)', 'Aftosa (Campana 2)', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)'],
  Ternera:    ['Aftosa (Campana 1)', 'Aftosa (Campana 2)', 'Brucelosis (Cepa 19) - unica en la vida', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)'],
  Vaquillona: ['Aftosa (Campana 1)', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)', 'Reproductivas (IBR+DVB+Lepto+Campy)'],
  Vaca:       ['Aftosa (Campana 1)', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)', 'Reproductivas (IBR+DVB+Lepto+Campy)', 'Diarrea Neonatal (Preparto - a la madre)'],
  Toro:       ['Aftosa (Campana 1)', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)', 'Reproductivas (IBR+DVB+Lepto+Campy)'],
  Torito:     ['Aftosa (Campana 1)', 'Clostridiales', 'Carbunclo Bacteridiano (Antrax)'],
};

// Tipo de animal → categoría de vacunación
export function tipoCategoriaVac(tipo) {
  const t = (tipo || '').toUpperCase().trim();
  if (t === 'T')  return 'Toro';
  if (t === 'TH') return 'Torito';
  if (t === 'TN') return 'Ternero'; // asumir macho hasta tener dato de sexo
  if (t === 'V')  return 'Vaca';
  if (t === 'VQ') return 'Vaquillona';
  return null;
}

// ─── Cargar datos de vacunación desde API ─────────────────────────────────────
export async function cargarVacunas() {
  try {
    const r = await fetch('/api/animales?modo=vacunas');
    const { vacunas } = await r.json();
    _vacunasData = vacunas || [];
  } catch (e) {
    console.warn('[vacunas] error cargando:', e);
    _vacunasData = [];
  }
}

// ─── Calcular estado de vacunas de un animal ──────────────────────────────────
// Devuelve array de { vacuna, estado, fecha_aplicacion, urgente }
export function estadoVacunasAnimal(animal, vacunasData) {
  const cat = tipoCategoriaVac(animal.tipo);
  if (!cat) return [];
  const aplicables = VAC_POR_CATEGORIA[cat] || [];

  return aplicables.map(nombreVac => {
    // Buscar el registro más reciente de esta vacuna para este animal
    const registros = (vacunasData || _vacunasData).filter(v =>
      (v.caravana && v.caravana === animal.caravana) ||
      (v.boton    && v.boton    === animal.boton)
    ).filter(v => v.vacuna === nombreVac);

    if (!registros.length) {
      if (nombreVac.includes('Brucelosis') && cat !== 'Ternera') {
        return { vacuna: nombreVac, estado: 'no_aplica', fecha_aplicacion: '', urgente: false };
      }
      return { vacuna: nombreVac, estado: 'pendiente', fecha_aplicacion: '', urgente: true };
    }

    // Tomar el más reciente
    const ult = registros.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    // Brucelosis: única en la vida — si está aplicada no vence
    if (nombreVac.includes('Brucelosis')) {
      return { vacuna: nombreVac, estado: 'aplicada', fecha_aplicacion: ult.fecha_aplicacion, urgente: false };
    }

    // Para las anuales, ver si venció
    const vigencia  = VIGENCIA_DIAS[nombreVac] || 365;
    const fechaApl  = ult.fecha_aplicacion
      ? new Date(ult.fecha_aplicacion.split('/').reverse().join('-'))
      : null;
    if (!fechaApl || isNaN(fechaApl.getTime())) {
      return { vacuna: nombreVac, estado: ult.estado || 'pendiente', fecha_aplicacion: ult.fecha_aplicacion, urgente: false };
    }

    const hoy          = new Date();
    const diasDesde    = Math.floor((hoy - fechaApl) / 86400000);
    const diasParaVencer = vigencia - diasDesde;

    if (diasParaVencer < 0)  return { vacuna: nombreVac, estado: 'vencida',    fecha_aplicacion: ult.fecha_aplicacion, urgente: true,  diasParaVencer };
    if (diasParaVencer < 60) return { vacuna: nombreVac, estado: 'por_vencer', fecha_aplicacion: ult.fecha_aplicacion, urgente: true,  diasParaVencer };
    return                         { vacuna: nombreVac, estado: 'aplicada',    fecha_aplicacion: ult.fecha_aplicacion, urgente: false, diasParaVencer };
  });
}

// ─── Calcular alertas globales para toda la hacienda ─────────────────────────
export function calcularAlertasGlobales(animales, vacunasData) {
  const alertas = [];
  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // 1-12

  let sinAftosa       = 0;
  let sinCarbunclo    = 0;
  let sinReproductivas = 0;
  let sinClostridiales = 0;
  let ternerasSinBruc  = 0;

  animales.forEach(a => {
    const estados = estadoVacunasAnimal(a, vacunasData);

    const aftosa = estados.find(e => e.vacuna.includes('Campana 1'));
    if (aftosa && (aftosa.estado === 'pendiente' || aftosa.estado === 'vencida')) sinAftosa++;

    const carbunclo = estados.find(e => e.vacuna.includes('Carbunclo'));
    if (carbunclo && (carbunclo.estado === 'pendiente' || carbunclo.estado === 'vencida')) sinCarbunclo++;

    const repro = estados.find(e => e.vacuna.includes('Reproductivas'));
    if (repro && (repro.estado === 'pendiente' || repro.estado === 'vencida')) sinReproductivas++;

    const clos = estados.find(e => e.vacuna.includes('Clostridiales'));
    if (clos && (clos.estado === 'pendiente' || clos.estado === 'vencida')) sinClostridiales++;

    // Brucelosis: solo terneras
    const cat = tipoCategoriaVac(a.tipo);
    if (cat === 'Ternera') {
      const bruc = estados.find(e => e.vacuna.includes('Brucelosis'));
      if (bruc && bruc.estado === 'pendiente') ternerasSinBruc++;
    }
  });

  if (ternerasSinBruc > 0) alertas.push({ nivel: 'rojo',    icono: '🔴', texto: `${ternerasSinBruc} ternera${ternerasSinBruc > 1 ? 's' : ''} sin Brucelosis — VENTANA DE EDAD EN RIESGO`, vacuna: 'brucelosis' });
  if (sinAftosa > 0)       alertas.push({ nivel: 'rojo',    icono: '🔴', texto: `${sinAftosa} animales sin Aftosa (Campaña 1) este año`, vacuna: 'aftosa' });
  if (sinCarbunclo > 0 && mes >= 9 && mes <= 12) alertas.push({ nivel: 'naranja',  icono: '🟠', texto: `${sinCarbunclo} animales sin Carbunclo — época de aplicación (Oct-Nov)`, vacuna: 'carbunclo' });
  if (sinClostridiales > 0) alertas.push({ nivel: 'amarillo', icono: '🟡', texto: `${sinClostridiales} animales sin Clostridiales este año`, vacuna: 'clostridiales' });
  if (sinReproductivas > 0) alertas.push({ nivel: 'amarillo', icono: '🟡', texto: `${sinReproductivas} animales sin Reproductivas este año`, vacuna: 'reproductivas' });

  return alertas;
}

// ─── Registrar vacunación via API ─────────────────────────────────────────────
export async function registrarVacunacion(datos, operador) {
  const body = { ...datos, modo: 'registro-vacuna', operador };
  const r = await fetch('/api/animales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export function getVacunasData() { return _vacunasData; }
