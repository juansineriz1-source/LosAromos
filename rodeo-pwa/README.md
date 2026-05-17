# 🐄 RodeoApp — PWA para Gestión Ganadera Offline

Sistema de registro ganadero diseñado para trabajar **sin señal en zonas rurales**, con sincronización automática a Google Sheets cuando vuelve la conexión.

---

## 📁 Estructura del Proyecto

```
rodeo-pwa/
├── index.html              # UI principal (botones grandes para uso con guantes)
├── sw.js                   # Service Worker con Workbox (Cache First + Background Sync)
├── manifest.json           # PWA manifest (instalable en Android/iOS)
├── workbox-config.js       # Config de build + instrucciones de despliegue
├── css/
│   └── estilos.css         # UI adaptada para campo (alto contraste, botones 64px)
└── js/
    ├── app.js              # Controlador principal
    ├── db.js               # Base de datos local (Dexie.js / IndexedDB)
    ├── bluetooth.js        # Integración con bastón lector BLE
    └── sync.js             # Sincronización con Google Sheets
```

---

## 🏗 Arquitectura de Datos (IndexedDB / Dexie.js)

### Tabla `animales`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `uuid` | string | UUID v4 generado en cliente (clave de idempotencia) |
| `caravana` | string | ID único del animal (indexado) |
| `categoria` | string | vaca/vaquillona/toro/ternero... |
| `raza` | string | Angus/Hereford/etc. |
| `sincronizado` | int | **0** pendiente · **1** sync OK · **2** conflicto |
| `timestamp_local` | int | Unix timestamp del dispositivo |
| `device_id` | string | UUID del dispositivo que cargó el dato |

### Tabla `registros_manga`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `uuid` | string | UUID v4 (idempotencia) |
| `caravana` | string | FK → animales.caravana |
| `peso_kg` | float | Peso en kilogramos |
| `estado_sanitario` | string | sano/vacunado/en_tratamiento/cuarentena |
| `vacuna_aplicada` | string | Nombre de la vacuna o medicamento |
| `operador` | string | Nombre del peón/veterinario |
| `fecha` | string | ISO date: "2024-06-15" |
| `sincronizado` | int | 0/1/2 |
| `timestamp_local` | int | Timestamp de carga |
| `device_id` | string | UUID del dispositivo |
| `sync_intentos` | int | Contador de reintentos fallidos |

### Tabla `sync_queue`
Cola de operaciones pendientes de enviar al servidor. Complementa el Background Sync del Service Worker con visibilidad desde la UI.

---

## ⚡ Flujo Offline → Online

```
Campo sin señal:
  Usuario escanea caravana (BLE) → App captura lectura
  ↓
  Carga peso, categoría, estado sanitario
  ↓
  "GUARDAR" → IndexedDB (local, inmediato) + encolar en sync_queue
  ↓
  Continuar con siguiente animal... (sin internet)

Cuando vuelve la señal:
  window 'online' event → sync.js detecta
  ↓
  Espera 2 segundos (red estabiliza)
  ↓
  Itera sync_queue → POST a Google Apps Script
  ↓
  Apps Script escribe en Google Sheets
  ↓
  Respuesta OK → marcar sincronizado: 1 en IndexedDB
  ↓
  Service Worker Background Sync como respaldo adicional
```

---

## 🔵 Bastones BLE Compatibles

El módulo `bluetooth.js` implementa el **Nordic UART Service (NUS)**, compatible con la mayoría de lectores ganaderos modernos:

- **Allflex RS420** — requiere UUID propietario (ver manual)
- **Herdsman HR4** — NUS estándar ✓
- **Tru-Test XRS2** — NUS estándar ✓
- **Cualquier lector ISO 11784/11785** con BLE UART

Para usar con un bastón diferente, solo hay que cambiar los UUIDs en `bluetooth.js`:
```js
const UUIDS = {
  UART_SERVICE: 'tu-uuid-de-servicio',
  UART_RX: 'tu-uuid-de-caracteristica-rx',
};
```

---

## ⚠️ Resolución de Conflictos

Cuando **dos dispositivos editan el mismo animal offline**, usamos:

### Estrategia: Last Write Wins con detección de conflictos reales

1. **Cada registro lleva `timestamp_local` y `device_id`**
2. Al sincronizar, el Apps Script compara el timestamp del registro entrante vs. el que ya está en el Sheet
3. **Si el entrante es más reciente → sobreescribe** (gana el último)
4. **Si la diferencia es < 60 segundos** (dos personas pesando el mismo animal casi simultáneamente) → el servidor retorna `{ conflicto: true }`
5. La app marca el registro con `sincronizado: 2` y lo muestra en la UI como "⚠ Conflicto — revisar"

### ¿Por qué "Last Write Wins" es correcto para ganado?
- En la manga, un animal pasa una sola vez. Si dos dispositivos tienen pesos diferentes para el mismo animal en el mismo día, lo más probable es que uno sea un error de tipeo.
- La resolución manual (ver el ⚠ en la app) permite al capataz decidir cuál peso es correcto.
- Para datos críticos (tratamientos veterinarios), se recomienda que el veterinario sea el único con permiso de escritura en esa columna del Sheet.

---

## 🚀 Instalación y Configuración

### 1. Clonar y servir localmente
```bash
git clone tu-repo rodeo-pwa
cd rodeo-pwa
npx serve . -p 3000
# Para HTTPS (necesario para BLE):
npx local-ssl-proxy --source 3443 --target 3000
```

### 2. Configurar Google Sheets
Ver instrucciones detalladas en `workbox-config.js` y el comentario al final de `sync.js`.

### 3. Instalar como PWA
- Android: Chrome → menú (⋮) → "Instalar app"
- iOS: Safari → Compartir → "Agregar a inicio"

### 4. Build de producción
```bash
npm install workbox-cli -g
workbox generateSW workbox-config.js
```

---

## 🏗 Tecnologías

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Frontend | Vanilla JS (ES Modules) | Máximo rendimiento, sin build step en dev |
| DB local | Dexie.js (IndexedDB) | API promisificada, soporte offline nativo |
| Service Worker | Workbox 7 | Cache First + Background Sync probados en producción |
| Bluetooth | Web Bluetooth API | Nativo en Chrome/Android, sin app nativa |
| Backend gratuito | Google Apps Script | Sin servidor, visual en Sheets, 0 costo |
| PWA | Web App Manifest | Instalable, ícono, splash screen |

---

## 📋 Columnas sugeridas en Google Sheets

**Hoja "registros_manga":**
`uuid | caravana | peso_kg | categoria | raza | estado_sanitario | vacuna_aplicada | observaciones | operador | fecha | hora | device_id | timestamp_local | sincronizado`

**Hoja "animales":**
`uuid | caravana | categoria | raza | fecha_nacimiento | device_id | timestamp_local`

Las columnas con color en el Sheet permiten filtrar rápidamente por fecha, operador o estado sanitario.
