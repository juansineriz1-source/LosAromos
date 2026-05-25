// ─── vacunas.js — Módulo de gestión de vacunación ────────────────────────────
// Plan Sanitario del Med. Vet. Micone Rubén Darío

// Cache de datos
let _vacunasData = []; // registros de la hoja Vacunacion

// Vacunas anuales — cuántos días de vigencia
const VIGENCIA_DIAS = {
  // Aftosa: 2 campañas SENASA por año
  'Aftosa (Campaña 1)':                        180, // cada 6 meses aprox
  'Aftosa (Campaña 2)':                        180,
  // Reproductivas — antes del servicio (anual)
  'Vacuna Reproductiva (IBR+DVB+Lepto+Campy)': 365,
  // Preparto — 30 días antes del parto (anual)
  'Vacuna Diarrea Neonatal (Preparto)':         365,
  // Clostridiales — en destete + refuerzo
  'Triple Clostridial':                         365,
  'Refuerzo Clostridial':                       365,
  // Virales — en destete + refuerzo
  'Vacuna Viral (IBR+DVB)':                     365,
  'Refuerzo Viral':                             365,
  // Carbunclo — dosis única anual
  'Carbunclo (Antrax)':                         365,
  // Desparasitante — no es vacuna pero el plan lo incluye
  'Desparasitante':                             180,
  // Brucelosis — única en la vida (hembras 3-10 meses)
  'Brucelosis (Cepa 19)':                       null, // única en la vida
  // Cobre — suplemento (vacas)
  'Cobre':                                      180,
};

// Plan vacunatorio por categoría — según plan sanitario Med. Vet. Micone
const VAC_POR_CATEGORIA = {
  // VAQUILLONA: Reproductiva (30d antes servicio) + Diarrea Neonatal (30d antes parto)
  //             + Carbunclo (1 dosis) + 2 dosis Aftosa + Desparasitante x2
  Vaquillona: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Vacuna Reproductiva (IBR+DVB+Lepto+Campy)',   // 30 días antes del servicio — PRIORIDAD ALTA
    'Vacuna Diarrea Neonatal (Preparto)',           // 30 días antes del parto — PRIORIDAD ALTA
    'Carbunclo (Antrax)',                          // 1 dosis anual
    'Desparasitante',                              // 2 veces al año
  ],

  // VACA: Cobre (30d antes servicio) + Diarrea Neonatal (30d antes parto)
  //       + Carbunclo (1 dosis) + 2 dosis Aftosa + Desparasitante
  Vaca: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Cobre',                                      // 30 días antes del servicio — PRIORIDAD ALTA
    'Vacuna Diarrea Neonatal (Preparto)',          // 30 días antes del parto — PRIORIDAD ALTA
    'Carbunclo (Antrax)',                         // 1 dosis anual
    'Desparasitante',                             // 2 veces al año
  ],

  // TERNERO (macho TM): Triple Clostridial (30d antes destete) + Refuerzo Clostridial (en destete)
  //                     + Vacuna Viral (destete) + Refuerzo Viral (entre 3 y 10 meses)
  //                     + 2 dosis Aftosa
  Ternero: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Triple Clostridial',                         // 30 días antes del destete — PRIORIDAD ALTA
    'Refuerzo Clostridial',                       // en el destete — PRIORIDAD ALTA
    'Vacuna Viral (IBR+DVB)',                     // en el destete
    'Refuerzo Viral',                             // entre los 3 y 10 meses
  ],

  // TERNERA (hembra TH): Igual que ternero + Brucelosis (entre 3 y 10 meses) — PRIORIDAD ALTA
  Ternera: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Triple Clostridial',                         // 30 días antes del destete — PRIORIDAD ALTA
    'Refuerzo Clostridial',                       // en el destete — PRIORIDAD ALTA
    'Vacuna Viral (IBR+DVB)',                     // en el destete
    'Refuerzo Viral',                             // entre los 3 y 10 meses
    'Brucelosis (Cepa 19)',                       // entre 3 y 10 meses — ÚNICA EN LA VIDA
  ],

  // MACHOS (Toritos/Toros): Vacuna Reproductiva + Carbunclo + Desparasitante + Aftosa
  Torito: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Vacuna Reproductiva (IBR+DVB+Lepto+Campy)',
    'Carbunclo (Antrax)',
    'Desparasitante',
  ],
  Toro: [
    'Aftosa (Campaña 1)',
    'Aftosa (Campaña 2)',
    'Vacuna Reproductiva (IBR+DVB+Lepto+Campy)',
    'Carbunclo (Antrax)',
    'Desparasitante',
  ],
};

// Prioridades de vacuna (ALTA = rojo, MEDIA = naranja, normal = verde)
export const PRIORIDAD_VACUNA = {
  'Brucelosis (Cepa 19)':                       'alta',  // ventana de edad
  'Vacuna Reproductiva (IBR+DVB+Lepto+Campy)':  'alta',  // antes del servicio
  'Vacuna Diarrea Neonatal (Preparto)':          'alta',  // antes del parto
  'Triple Clostridial':                          'alta',  // antes del destete
  'Refuerzo Clostridial':                        'alta',
  'Aftosa (Campaña 1)':                          'alta',  // obligatoria SENASA
  'Aftosa (Campaña 2)':                          'alta',  // obligatoria SENASA
  'Cobre':                                       'media',
  'Desparasitante':                              'media',
  'Vacuna Viral (IBR+DVB)':                      'media',
  'Refuerzo Viral':                              'media',
  'Carbunclo (Antrax)':                          'media',
};

// Tipo de animal → categoría de vacunación
export function tipoCategoriaVac(tipo) {
  const t = (tipo || '').toUpperCase().trim();
  if (t === 'T')  return 'Toro';
  if (t === 'TH') return 'Ternera';   // TH = Ternera Hembra (necesita Brucelosis)
  if (t === 'TM') return 'Ternero';   // TM = Ternero Macho
  if (t === 'V')  return 'Vaca';
  if (t === 'VQ') return 'Vaquillona';
  // V1-V6 se tratan como Vaca
  if (t.startsWith('V')) return 'Vaca';
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
// Devuelve array de { vacuna, estado, fecha_aplicacion, urgente, prioridad }
export function estadoVacunasAnimal(animal, vacunasData) {
  const cat = tipoCategoriaVac(animal.tipo);
  if (!cat) return [];
  const aplicables = VAC_POR_CATEGORIA[cat] || [];

  return aplicables.map(nombreVac => {
    const prioridad = PRIORIDAD_VACUNA[nombreVac] || 'normal';

    // Buscar el registro más reciente de esta vacuna para este animal
    const registros = (vacunasData || _vacunasData).filter(v =>
      (v.caravana && v.caravana === animal.caravana) ||
      (v.boton    && v.boton    === animal.boton)
    ).filter(v => v.vacuna === nombreVac);

    if (!registros.length) {
      return { vacuna: nombreVac, estado: 'pendiente', fecha_aplicacion: '', urgente: prioridad === 'alta', prioridad };
    }

    // Tomar el más reciente
    const ult = registros.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    // Brucelosis: única en la vida — si está aplicada no vence nunca
    if (nombreVac.includes('Brucelosis')) {
      return { vacuna: nombreVac, estado: 'aplicada', fecha_aplicacion: ult.fecha_aplicacion, urgente: false, prioridad };
    }

    // Desparasitante y Cobre: no se vencen en la lógica de alerta
    if (nombreVac === 'Desparasitante' || nombreVac === 'Cobre') {
      const vigencia = VIGENCIA_DIAS[nombreVac] || 180;
      const fechaApl = ult.fecha_aplicacion
        ? new Date(ult.fecha_aplicacion.split('/').reverse().join('-'))
        : null;
      if (!fechaApl || isNaN(fechaApl.getTime())) {
        return { vacuna: nombreVac, estado: 'aplicada', fecha_aplicacion: ult.fecha_aplicacion, urgente: false, prioridad };
      }
      const diasDesde = Math.floor((new Date() - fechaApl) / 86400000);
      if (diasDesde > vigencia) return { vacuna: nombreVac, estado: 'vencida', fecha_aplicacion: ult.fecha_aplicacion, urgente: true, prioridad };
      return { vacuna: nombreVac, estado: 'aplicada', fecha_aplicacion: ult.fecha_aplicacion, urgente: false, prioridad };
    }

    // Para las anuales, ver si venció
    const vigencia = VIGENCIA_DIAS[nombreVac] || 365;
    const fechaApl = ult.fecha_aplicacion
      ? new Date(ult.fecha_aplicacion.split('/').reverse().join('-'))
      : null;
    if (!fechaApl || isNaN(fechaApl.getTime())) {
      return { vacuna: nombreVac, estado: ult.estado || 'pendiente', fecha_aplicacion: ult.fecha_aplicacion, urgente: false, prioridad };
    }

    const diasDesde    = Math.floor((new Date() - fechaApl) / 86400000);
    const diasParaVencer = vigencia - diasDesde;

    if (diasParaVencer < 0)  return { vacuna: nombreVac, estado: 'vencida',    fecha_aplicacion: ult.fecha_aplicacion, urgente: true,  diasParaVencer, prioridad };
    if (diasParaVencer < 60) return { vacuna: nombreVac, estado: 'por_vencer', fecha_aplicacion: ult.fecha_aplicacion, urgente: true,  diasParaVencer, prioridad };
    return                         { vacuna: nombreVac, estado: 'aplicada',    fecha_aplicacion: ult.fecha_aplicacion, urgente: false, diasParaVencer, prioridad };
  });
}

// ─── Calcular alertas globales para toda la hacienda ─────────────────────────
export function calcularAlertasGlobales(animales, vacunasData) {
  const alertas = [];

  let sinAftosa1       = 0;
  let sinAftosa2       = 0;
  let sinReproductivas = 0;
  let sinPreparto      = 0;
  let sinClostridial   = 0;
  let sinCarbunclo     = 0;
  let ternerasSinBruc  = 0;

  animales.forEach(a => {
    const estados = estadoVacunasAnimal(a, vacunasData);
    const pendVenc = e => e && (e.estado === 'pendiente' || e.estado === 'vencida');

    const aftosa1 = estados.find(e => e.vacuna.includes('Campaña 1'));
    if (pendVenc(aftosa1)) sinAftosa1++;

    const aftosa2 = estados.find(e => e.vacuna.includes('Campaña 2'));
    if (pendVenc(aftosa2)) sinAftosa2++;

    const repro = estados.find(e => e.vacuna.includes('Reproductiva'));
    if (pendVenc(repro)) sinReproductivas++;

    const preparto = estados.find(e => e.vacuna.includes('Neonatal'));
    if (pendVenc(preparto)) sinPreparto++;

    const clost = estados.find(e => e.vacuna.includes('Clostridial') && !e.vacuna.includes('Refuerzo'));
    if (pendVenc(clost)) sinClostridial++;

    const carbunclo = estados.find(e => e.vacuna.includes('Carbunclo'));
    if (pendVenc(carbunclo)) sinCarbunclo++;

    // Brucelosis: solo terneras hembras
    const cat = tipoCategoriaVac(a.tipo);
    if (cat === 'Ternera') {
      const bruc = estados.find(e => e.vacuna.includes('Brucelosis'));
      if (bruc && bruc.estado === 'pendiente') ternerasSinBruc++;
    }
  });

  // 🔴 PRIORIDAD ALTA
  if (ternerasSinBruc > 0)  alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${ternerasSinBruc} ternera${ternerasSinBruc > 1 ? 's' : ''} sin Brucelosis — VENTANA DE EDAD EN RIESGO`, vacuna: 'brucelosis' });
  if (sinAftosa1 > 0)       alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${sinAftosa1} animales sin Aftosa Campaña 1 (obligatorio SENASA)`, vacuna: 'aftosa1' });
  if (sinAftosa2 > 0)       alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${sinAftosa2} animales sin Aftosa Campaña 2 (obligatorio SENASA)`, vacuna: 'aftosa2' });
  if (sinReproductivas > 0) alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${sinReproductivas} animales sin Vacuna Reproductiva — aplicar 30 días antes del servicio`, vacuna: 'reproductiva' });
  if (sinPreparto > 0)      alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${sinPreparto} animales sin Vacuna Preparto (Diarrea Neonatal) — aplicar 30 días antes del parto`, vacuna: 'preparto' });
  if (sinClostridial > 0)   alertas.push({ nivel: 'rojo',     icono: '🔴', texto: `${sinClostridial} terneros/terneras sin Triple Clostridial — aplicar 30 días antes del destete`, vacuna: 'clostridial' });

  // 🟠 PRIORIDAD MEDIA
  if (sinCarbunclo > 0)     alertas.push({ nivel: 'naranja',  icono: '🟠', texto: `${sinCarbunclo} animales sin Carbunclo (Antrax) — 1 dosis anual`, vacuna: 'carbunclo' });

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
