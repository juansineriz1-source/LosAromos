/**
 * crear-hoja-sangrado.gs
 * 
 * Ejecutar en Google Apps Script del Spreadsheet de Los Aromos.
 * Crea la hoja "Sangrado" con cabeceras, formato y validaciones.
 * 
 * Cómo usarlo:
 *   1. Abrí el Google Sheet de Los Aromos
 *   2. Extensiones → Apps Script
 *   3. Pegá este código y hacé click en ▶ Ejecutar (crearHojaSangrado)
 */

function crearHojaSangrado() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ── Verificar si ya existe ──────────────────────────────────────────────────
  let hoja = ss.getSheetByName('Sangrado');
  if (hoja) {
    const ui = SpreadsheetApp.getUi();
    const resp = ui.alert(
      'La hoja "Sangrado" ya existe',
      '¿Querés reemplazarla? Se borrarán todos los datos.',
      ui.ButtonSet.YES_NO
    );
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(hoja);
  }
  
  // ── Crear hoja ──────────────────────────────────────────────────────────────
  hoja = ss.insertSheet('Sangrado');
  
  // ── Cabeceras ───────────────────────────────────────────────────────────────
  const CABECERAS = [
    'fecha',
    'tipo_estudio',
    'veterinario',
    'total_rodeo',
    'animales_muestreados',
    'resultado',
    'reactores',
    'accion',
    'proxima_fecha',
    'comentarios',
    'operador',
    'timestamp'
  ];
  
  const filaCabeceras = hoja.getRange(1, 1, 1, CABECERAS.length);
  filaCabeceras.setValues([CABECERAS]);
  
  // ── Formato cabeceras ────────────────────────────────────────────────────────
  filaCabeceras
    .setBackground('#0f5228')        // verde Los Aromos
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center');
  
  // ── Anchos de columna ────────────────────────────────────────────────────────
  const ANCHOS = [110, 140, 160, 110, 150, 120, 90, 170, 120, 220, 110, 160];
  ANCHOS.forEach((ancho, i) => hoja.setColumnWidth(i + 1, ancho));
  
  // ── Congelar fila de cabecera ────────────────────────────────────────────────
  hoja.setFrozenRows(1);
  
  // ── Validaciones de datos ────────────────────────────────────────────────────
  
  // Col B — tipo_estudio
  const valTipo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Brucelosis', 'Tuberculosis', 'Leucosis', 'Otro'], true)
    .setAllowInvalid(false)
    .build();
  hoja.getRange('B2:B1000').setDataValidation(valTipo);
  
  // Col F — resultado
  const valResultado = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Negativo', 'Con reactores', 'Pendiente'], true)
    .setAllowInvalid(false)
    .build();
  hoja.getRange('F2:F1000').setDataValidation(valResultado);
  
  // Col H — accion
  const valAccion = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      'Ninguna',
      'Sangrado total del rodeo',
      'Eliminación de reactores',
      'Sangrado total + Eliminación'
    ], true)
    .setAllowInvalid(false)
    .build();
  hoja.getRange('H2:H1000').setDataValidation(valAccion);
  
  // ── Formato de fechas (col A y I) ────────────────────────────────────────────
  hoja.getRange('A2:A1000').setNumberFormat('dd/mm/yyyy');
  hoja.getRange('I2:I1000').setNumberFormat('dd/mm/yyyy');
  hoja.getRange('L2:L1000').setNumberFormat('dd/mm/yyyy hh:mm:ss');
  
  // ── Formato numérico (col D, E, G) ──────────────────────────────────────────
  hoja.getRange('D2:E1000').setNumberFormat('0');
  hoja.getRange('G2:G1000').setNumberFormat('0');
  
  // ── Formato condicional: resultado ──────────────────────────────────────────
  const reglas = [];
  
  // Negativo → fondo verde claro
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Negativo')
    .setBackground('#d4edda')
    .setFontColor('#155724')
    .setRanges([hoja.getRange('F2:F1000')])
    .build());
  
  // Con reactores → fondo rojo claro
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Con reactores')
    .setBackground('#f8d7da')
    .setFontColor('#721c24')
    .setRanges([hoja.getRange('F2:F1000')])
    .build());
  
  // Pendiente → fondo amarillo
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Pendiente')
    .setBackground('#fff3cd')
    .setFontColor('#856404')
    .setRanges([hoja.getRange('F2:F1000')])
    .build());
  
  hoja.setConditionalFormatRules(reglas);
  
  // ── Fila de ejemplo ──────────────────────────────────────────────────────────
  const hoy = new Date();
  const ejemploFecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const proximaFecha = new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());
  
  hoja.getRange(2, 1, 1, CABECERAS.length).setValues([[
    ejemploFecha,          // fecha
    'Brucelosis',          // tipo_estudio
    'Med. Vet. Micone',    // veterinario
    190,                   // total_rodeo
    28,                    // animales_muestreados (≈15% de 190)
    'Negativo',            // resultado
    0,                     // reactores
    'Ninguna',             // accion
    proximaFecha,          // proxima_fecha
    'Fila de ejemplo — podés borrarla', // comentarios
    'Sistema',             // operador
    new Date()             // timestamp
  ]]);
  
  // Color de fondo alternado para legibilidad
  hoja.getRange(2, 1, 1, CABECERAS.length).setBackground('#f0f7f0');
  
  // ── Mensaje final ────────────────────────────────────────────────────────────
  SpreadsheetApp.getUi().alert(
    '✅ Hoja "Sangrado" creada correctamente',
    `Se creó con ${CABECERAS.length} columnas, validaciones y una fila de ejemplo.\n\nPodés borrar la fila de ejemplo cuando quieras.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
  
  Logger.log('✅ Hoja Sangrado creada correctamente.');
}
