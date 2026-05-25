/**
 * bluetooth.js — Módulo de integración con bastón lector BLE de caravanas
 *
 * Protocolo: GATT (Generic Attribute Profile) sobre BLE.
 * El bastón lector típico (ej: Allflex RS420, Herdsman, Tru-Test) expone
 * un servicio de UART/Serial sobre BLE con características Notify.
 *
 * UUIDs configurables según el bastón que uses:
 *   - Nordic UART Service (NUS): el más común en lectores ganaderos.
 *   - Algunos bastones usan UUID propietarios — consultar manual del dispositivo.
 *
 * IMPORTANTE: Web Bluetooth solo funciona en contexto HTTPS y requiere
 * interacción del usuario (no puede iniciarse automáticamente).
 */

// ─── UUIDs GATT (ajustar según tu bastón) ──────────────────────────────────
const UUIDS = {
  // Nordic UART Service — el más usado en bastones modernos
  UART_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  UART_TX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // escritura hacia el bastón
  UART_RX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // recibir lecturas del bastón

  // Alternativa: servicio genérico de lectura (algunos bastones más simples)
  GENERIC_SERVICE: '0000ffe0-0000-1000-8000-00805f9b34fb',
  GENERIC_NOTIFY: '0000ffe1-0000-1000-8000-00805f9b34fb',
};

// ─── Estado del módulo ─────────────────────────────────────────────────────
let dispositivoBLE = null;      // BluetoothDevice
let servidorGATT = null;        // BluetoothRemoteGATTServer
let caracteristicaRX = null;    // Para recibir datos
let buffer = '';                // Buffer para lecturas parciales

// ─── Callbacks externos ────────────────────────────────────────────────────
let onCaravanaLeida = null;     // fn(caravana: string) — llamado al recibir lectura
let onEstadoCambiado = null;    // fn(estado: 'conectado'|'desconectado'|'error', msg?)
let onRSSI = null;              // fn(dbm: number) — señal Bluetooth

/**
 * Verifica si el navegador soporta Web Bluetooth.
 */
export function bluetoothDisponible() {
  return 'bluetooth' in navigator;
}

/**
 * Conecta al bastón lector de caravanas.
 * Abre el diálogo de selección de dispositivo Bluetooth del navegador.
 *
 * @param {Object} callbacks — { onCaravana, onEstado, onRSSI }
 * @returns {Promise<boolean>} — true si conectó exitosamente
 */
export async function conectarBaston(callbacks = {}) {
  if (!bluetoothDisponible()) {
    throw new Error('Web Bluetooth no está disponible en este navegador.');
  }

  // Registrar callbacks
  onCaravanaLeida = callbacks.onCaravana || (() => {});
  onEstadoCambiado = callbacks.onEstado || (() => {});
  onRSSI = callbacks.onRSSI || (() => {});

  try {
    onEstadoCambiado('buscando', 'Buscando bastón lector...');

    // Solicitar dispositivo — el navegador muestra la UI de selección
    dispositivoBLE = await navigator.bluetooth.requestDevice({
      // Filtro por nombre — ajustar según el bastón:
      // filters: [{ namePrefix: 'Allflex' }, { namePrefix: 'HID' }],
      
      // Para desarrollo: acepta cualquier dispositivo BLE
      acceptAllDevices: true,
      optionalServices: [
        UUIDS.UART_SERVICE,
        UUIDS.GENERIC_SERVICE,
        // Agregar UUIDs propietarios del bastón si es necesario
      ],
    });

    console.log('[BT] Dispositivo seleccionado:', dispositivoBLE.name);

    // Escuchar desconexiones inesperadas
    dispositivoBLE.addEventListener('gattserverdisconnected', _manejarDesconexion);

    // Conectar al servidor GATT
    onEstadoCambiado('conectando', `Conectando a ${dispositivoBLE.name}...`);
    servidorGATT = await dispositivoBLE.gatt.connect();

    // Intentar conectar al servicio UART primero, luego al genérico
    const conectado = await _inicializarServicio();

    if (conectado) {
      onEstadoCambiado('conectado', dispositivoBLE.name);
      return true;
    } else {
      throw new Error('No se encontró servicio compatible en el bastón.');
    }

  } catch (error) {
    if (error.name === 'NotFoundError') {
      // El usuario canceló la selección — no es un error real
      onEstadoCambiado('cancelado', 'Selección cancelada');
    } else {
      console.error('[BT] Error de conexión:', error);
      onEstadoCambiado('error', error.message);
    }
    return false;
  }
}

/**
 * Intenta inicializar el servicio GATT del bastón.
 * Prueba UART primero, luego servicio genérico.
 */
async function _inicializarServicio() {
  // Intentar Nordic UART Service
  try {
    const servicio = await servidorGATT.getPrimaryService(UUIDS.UART_SERVICE);
    caracteristicaRX = await servicio.getCharacteristic(UUIDS.UART_RX);
    await caracteristicaRX.startNotifications();
    caracteristicaRX.addEventListener('characteristicvaluechanged', _procesarLecturaBLE);
    console.log('[BT] Conectado via Nordic UART Service');
    return true;
  } catch (e) {
    console.warn('[BT] UART Service no disponible, intentando genérico...', e.message);
  }

  // Intentar servicio genérico BLE (bastones más simples)
  try {
    const servicio = await servidorGATT.getPrimaryService(UUIDS.GENERIC_SERVICE);
    caracteristicaRX = await servicio.getCharacteristic(UUIDS.GENERIC_NOTIFY);
    await caracteristicaRX.startNotifications();
    caracteristicaRX.addEventListener('characteristicvaluechanged', _procesarLecturaBLE);
    console.log('[BT] Conectado via servicio genérico');
    return true;
  } catch (e) {
    console.warn('[BT] Servicio genérico no disponible:', e.message);
  }

  return false;
}

/**
 * Procesa los bytes recibidos desde el bastón.
 * Los bastones RFID envían el número de caravana como string ASCII
 * terminado en '\n' o '\r\n', a veces con prefijo/sufijo.
 *
 * Formato típico Allflex/ISO 11784: "900 000 000 123456\r\n"
 * Formato típico HID: "123456789\n"
 */
function _procesarLecturaBLE(event) {
  const valor = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const texto = decoder.decode(valor);

  buffer += texto;

  // Buscar terminadores de línea (fin de lectura)
  const lineas = buffer.split(/[\r\n]+/);

  // Procesar todas las líneas completas (excepto el último fragmento)
  for (let i = 0; i < lineas.length - 1; i++) {
    const linea = lineas[i].trim();
    if (linea.length > 0) {
      const caravana = _normalizarCaravana(linea);
      if (caravana) {
        console.log('[BT] Caravana leída:', caravana);
        onCaravanaLeida(caravana);
      }
    }
  }

  // Mantener el fragmento incompleto en el buffer
  buffer = lineas[lineas.length - 1];
}

/**
 * Normaliza el número de caravana recibido.
 * Elimina prefijos de protocolo, espacios y caracteres de control.
 *
 * Ajustar según el formato que devuelve tu bastón específico.
 */
function _normalizarCaravana(raw) {
  // Eliminar caracteres no imprimibles y espacios extremos
  let caravana = raw.replace(/[^\x20-\x7E]/g, '').trim();

  // Eliminar prefijo ISO 11784 si lo trae (ej: "900 " al inicio)
  // caravana = caravana.replace(/^900\s+/, '');

  // Solo retornar si tiene contenido válido (mínimo 4 caracteres)
  return caravana.length >= 4 ? caravana : null;
}

/**
 * Maneja desconexión inesperada del bastón.
 */
function _manejarDesconexion() {
  console.warn('[BT] Bastón desconectado inesperadamente');
  onEstadoCambiado('desconectado', 'Bastón desconectado');
  caracteristicaRX = null;
  servidorGATT = null;

  // Intentar reconexión automática después de 3 segundos
  setTimeout(async () => {
    if (dispositivoBLE) {
      console.log('[BT] Intentando reconexión automática...');
      onEstadoCambiado('reconectando', 'Reconectando...');
      try {
        servidorGATT = await dispositivoBLE.gatt.connect();
        await _inicializarServicio();
        onEstadoCambiado('conectado', dispositivoBLE.name);
      } catch (e) {
        onEstadoCambiado('error', 'No se pudo reconectar. Presioná "Conectar Bastón".');
      }
    }
  }, 3000);
}

/**
 * Desconecta limpiamente el bastón.
 */
export async function desconectarBaston() {
  if (caracteristicaRX) {
    try {
      await caracteristicaRX.stopNotifications();
      caracteristicaRX.removeEventListener('characteristicvaluechanged', _procesarLecturaBLE);
    } catch (e) {
      // Puede fallar si ya estaba desconectado
    }
    caracteristicaRX = null;
  }

  if (servidorGATT?.connected) {
    servidorGATT.disconnect();
  }

  servidorGATT = null;
  dispositivoBLE = null;
  buffer = '';
  onEstadoCambiado('desconectado', 'Bastón desconectado');
}

/**
 * Retorna el estado actual de la conexión BLE.
 */
export function estadoBluetooth() {
  return {
    disponible: bluetoothDisponible(),
    conectado: servidorGATT?.connected ?? false,
    dispositivo: dispositivoBLE?.name ?? null,
  };
}

/**
 * Simula una lectura de caravana (para pruebas sin bastón físico).
 */
export function simularLectura(caravana = null) {
  const caravanaSimulada = caravana || `SIM-${Math.floor(Math.random() * 90000) + 10000}`;
  console.log('[BT] SIMULACIÓN — Caravana:', caravanaSimulada);
  if (onCaravanaLeida) {
    onCaravanaLeida(caravanaSimulada);
  }
}

/**
 * Redirige el callback de lectura de caravana a otra función,
 * sin necesidad de reconectar el bastón.
 * Útil para que otros módulos (Pesadas, etc.) reciban las lecturas
 * mientras el bastón ya está conectado.
 *
 * @param {function|null} fn — nueva función receptora, o null para restaurar el original
 * @param {function} [original] — función original a restaurar cuando fn es null
 */
export function setCallbackCaravana(fn) {
  onCaravanaLeida = fn || (() => {});
}

/**
 * Indica si el bastón está actualmente conectado.
 */
export function isConectado() {
  return servidorGATT?.connected ?? false;
}
