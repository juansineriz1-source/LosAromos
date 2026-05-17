# RODEOAPP — DIAGRAMA DE FLUJO Y CONTEXTO GENERAL

> **📋 DOCUMENTO VIVO** — Este archivo se actualiza con cada cambio significativo al proyecto.
> Última actualización: 2026-05-17

---

## ESTADO ACTUAL DEL PROYECTO

### Estructura de Archivos Real

```
Los Aromos/                        ← Raíz del proyecto (archivos de desarrollo)
│
├── contexto.md                    ← Este archivo (documento vivo del proyecto)
├── README.md                      ← Documentación general
│
├── index.html                     ← UI principal (copia raíz, para dev rápido)
├── app.js                         ← Controlador principal (copia raíz)
├── bluetooth.js                   ← Módulo BLE (copia raíz)
├── db.js                          ← Base de datos Dexie (copia raíz)
├── sync.js                        ← Sincronización Google Sheets (copia raíz)
├── sw.js                          ← Service Worker (copia raíz)
├── estilos.css                    ← Estilos (copia raíz)
│
└── rodeo-pwa/                     ← Versión estructurada / producción
    ├── index.html
    ├── sw.js
    ├── manifest.json
    ├── workbox-config.js          ← Config de build + instrucciones deploy
    ├── js/
    │   ├── app.js
    │   ├── db.js
    │   ├── bluetooth.js
    │   └── sync.js
    └── css/
        └── estilos.css
```

### Stack tecnológico activo

| Capa | Tecnología | Versión/Detalle |
|------|-----------|-----------------|
| Frontend | Vanilla JS (ES Modules) | Sin build step en dev |
| DB local | Dexie.js | v3.2.4 (CDN jsDelivr) |
| Service Worker | Workbox 7 | Cache First + Background Sync |
| Bluetooth | Web Bluetooth API | Nordic UART Service (NUS) |
| Backend | Google Apps Script | URL pública como REST endpoint |
| PWA | Web App Manifest | Instalable en Android/iOS |

### Constantes clave del dominio (db.js)

```js
CATEGORIAS        = ['vaca', 'vaquillona', 'toro', 'ternero', 'ternera', 'novillito', 'novillo']
ESTADOS_SANITARIOS = ['sano', 'vacunado', 'en_tratamiento', 'cuarentena', 'revisar']
RAZAS             = ['Aberdeen Angus', 'Hereford', 'Shorthorn', 'Brahman', 'Brangus', 'Criolla', 'Holstein', 'Otra']
```

### UUIDs BLE (bluetooth.js)

```
Nordic UART Service (NUS):       6e400001-b5a3-f393-e0a9-e50e24dcca9e   ← intento 1
Servicio Genérico BLE fallback:  0000ffe0-0000-1000-8000-00805f9b34fb   ← intento 2
```

### Bastones BLE compatibles

| Bastón | Protocolo | Estado |
|--------|-----------|--------|
| Herdsman HR4 | NUS estándar | ✓ Confirmado |
| Tru-Test XRS2 | NUS estándar | ✓ Confirmado |
| Allflex RS420 | UUID propietario | ⚠ Requiere config manual |
| Cualquier ISO 11784/11785 BLE | NUS o Genérico | Compatible |

---

## HISTORIAL DE CAMBIOS

### 2026-05-17 — Inicio del documento vivo
- Proyecto tomado como contexto por primera vez
- Se verifica la estructura real de archivos: existe carpeta raíz con archivos de dev + subcarpeta `rodeo-pwa/` con estructura organizada
- Se actualiza `contexto.md` para funcionar como documento vivo mantenido en cada sesión

---



```
┌─────────────────────────────────────────────────────────────────┐
│                        RODEOAPP PWA                             │
│            Registro ganadero offline-first                      │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     ¿HAY SEÑAL DE RED?                SERVICE WORKER
       (navigator.onLine)              (sw.js — Workbox)
              │                               │
       ┌──────┴──────┐                ┌───────┴────────┐
       │  SÍ: Online │                │  Cache First   │
       │  ● Verde    │                │  Assets HTML/  │
       └──────┬──────┘                │  JS/CSS/iconos │
              │                       └───────┬────────┘
       └──────┴──────┐                        │
       │ NO: Offline │                ┌───────┴────────┐
       │  ○ Rojo     │                │ Background Sync│
       └──────┬──────┘                │ POST pendientes│
              │                       │ → /api/sinc    │
              ▼                       └────────────────┘
```

---

## FLUJO PRINCIPAL DE USO EN LA MANGA

```
INICIO DE JORNADA
      │
      ▼
[1. OPERADOR abre la app en el celular]
      │
      ├── App instalada como PWA (ícono en pantalla)
      ├── Service Worker ya cacheó todos los assets
      └── Funciona aunque no haya internet
      │
      ▼
[2. CONECTAR BASTÓN LECTOR BLE]
      │
      ├── Usuario toca "📡 Conectar Bastón"
      ├── Navegador abre selector de dispositivos Bluetooth
      ├── Usuario elige el bastón (ej: Herdsman HR4, Tru-Test XRS2)
      │
      ├── bluetooth.js intenta Nordic UART Service (NUS)
      │       └── UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
      │
      ├── Si NUS falla → intenta Servicio Genérico BLE
      │       └── UUID: 0000ffe0-0000-1000-8000-00805f9b34fb
      │
      ├── Conectado ✓ → badge "🔵 HR4 conectado"
      └── Error → mensaje de error + botón para reintentar
      │
      ▼
[3. ESCANEAR ANIMAL EN LA MANGA]
      │
      ├── Operario acerca el bastón a la oreja del animal
      ├── Bastón lee la caravana RFID/ISO 11784
      ├── Envía string ASCII vía BLE NOTIFY characteristic
      │
      ├── bluetooth.js recibe bytes → buffer acumula
      ├── Detecta '\n' o '\r\n' → fin de lectura
      ├── _normalizarCaravana() limpia el string
      │       └── Elimina prefijos de protocolo, espacios, control chars
      │
      ├── onCaravanaLeida("AR-1234-5678") → app.js
      ├── Input caravana se llena automáticamente
      ├── Flash verde en el campo + vibración háptica
      └── Foco salta al campo "Peso" automáticamente
      │
      ▼
[4. CARGAR DATOS DEL ANIMAL]
      │
      ├── Campo: Peso en kg (número grande, teclado numérico)
      ├── Campo: Categoría (vaca / vaquillona / toro / ternero...)
      ├── Campo: Raza (Angus / Hereford / Shorthorn / Brangus...)
      ├── Campo: Estado sanitario (sano / vacunado / en tratamiento...)
      ├── Campo: Vacuna o medicamento aplicado (opcional)
      └── Campo: Observaciones (opcional)
      │
      │   ◄── Se muestra historial del animal (últimos 5 registros)
      │         tomado de IndexedDB local
      │
      ▼
[5. TOCAR "💾 GUARDAR"]
      │
      ├── Validación:
      │       ├── ¿Hay caravana? Si no → toast advertencia
      │       └── ¿Peso entre 1 y 1500 kg? Si no → toast advertencia
      │
      ├── db.js → guardarAnimal()
      │       ├── Busca si ya existe la caravana en IndexedDB
      │       ├── Si existe → UPDATE (mantiene UUID original)
      │       └── Si es nuevo → INSERT con UUID = crypto.randomUUID()
      │
      ├── db.js → guardarRegistroManga()
      │       ├── Crea registro con UUID nuevo
      │       ├── Agrega: fecha, hora, device_id, timestamp_local
      │       └── sincronizado: 0  ← pendiente de envío
      │
      ├── db.js → encolarSync()
      │       └── Agrega a tabla sync_queue: {tabla, uuid, payload}
      │
      ├── Toast "✓ Guardado: AR-1234 — 320 kg"
      ├── Vibración de confirmación
      └── Formulario se limpia → listo para el siguiente animal
```

---

## FLUJO DE SINCRONIZACIÓN

```
MIENTRAS NO HAY RED (campo sin señal)
      │
      └── Todos los datos viven en IndexedDB (local)
          sync_queue acumula operaciones pendientes
          La app muestra: "3 pendientes"

                    │
      ┌─────────────┴──────────────┐
      │   CUANDO VUELVE LA SEÑAL   │
      └─────────────┬──────────────┘
                    │
                    ▼
      window evento 'online' → sync.js detecta
                    │
                    ▼
      Espera 2 segundos (red estabiliza)
                    │
                    ▼
      sincronizarPendientes()
                    │
                    ├── Lee toda la sync_queue (Dexie)
                    │
                    ├── Por cada registro pendiente:
                    │       │
                    │       ├── POST → Google Apps Script URL
                    │       │     Body: { tabla, accion, datos, clave_idempotencia: uuid }
                    │       │
                    │       ├── Respuesta { ok: true }
                    │       │       └── marcarComoSincronizado()
                    │       │           sincronizado: 0 → 1 ✓
                    │       │           eliminar de sync_queue
                    │       │
                    │       ├── Respuesta { ok: false, conflicto: true }
                    │       │       └── sincronizado: 0 → 2 ⚠
                    │       │           Mostrar en UI como "conflicto"
                    │       │
                    │       └── Error de red
                    │               └── incrementar sync_intentos
                    │                   guardar ultimo_error
                    │                   reencolar para próximo intento
                    │
                    └── Toast resumen: "✓ 5 registros enviados a Sheets"

      RESPALDO: Service Worker Background Sync
                    │
                    └── Si la app estaba cerrada cuando volvió la red,
                        el SW ejecuta la cola igualmente en background
```

---

## RESOLUCIÓN DE CONFLICTOS (dos dispositivos offline)

```
Dispositivo A (peón 1) edita caravana AR-1234 a las 10:00
Dispositivo B (peón 2) edita caravana AR-1234 a las 10:05
Ambos sin red → cada uno guarda localmente con su timestamp

                    │
                    ▼
      Cuando vuelve la red, ambos intentan sincronizar

      Google Apps Script recibe registro de A (timestamp 10:00)
              └── Escribe en el Sheet

      Google Apps Script recibe registro de B (timestamp 10:05)
              └── Compara: timestamp B > timestamp A
              └── SOBRESCRIBE (Last Write Wins) ← gana el más reciente

      CASO ESPECIAL: diferencia < 60 segundos
              └── Retorna { conflicto: true }
              └── App marca sincronizado: 2 (⚠ conflicto)
              └── Capataz decide manualmente cuál es correcto
```

---

## ARQUITECTURA DE ARCHIVOS

```
rodeo-pwa/
│
├── index.html              → UI principal
│       ├── Header: estado red + estado bluetooth + operador
│       ├── Card 1: botón conectar bastón + simular
│       ├── Card 2: input caravana + historial del animal
│       ├── Card 3: peso + categoría + raza + sanidad + vacuna + obs
│       ├── Card 4: botón GUARDAR + limpiar
│       └── Card 5: botón sync + contador pendientes
│
├── sw.js                   → Service Worker (Workbox 7)
│       ├── precacheAndRoute: HTML, JS, CSS, manifest
│       ├── CacheFirst: assets estáticos (30 días)
│       ├── NetworkFirst: Google Sheets API (fallback 5s)
│       └── BackgroundSync: POST /api/sincronizar
│
├── manifest.json           → PWA (instalable, ícono, splash)
│
├── workbox-config.js       → Config build + instrucciones deploy
│
├── js/
│   ├── db.js               → Base de datos local (Dexie / IndexedDB)
│   │       ├── Tabla: animales (uuid, caravana, categoria, raza...)
│   │       ├── Tabla: registros_manga (uuid, caravana, peso_kg, estado...)
│   │       ├── Tabla: sync_queue (operaciones pendientes)
│   │       └── Tabla: config (configuración del dispositivo)
│   │
│   ├── bluetooth.js        → Web Bluetooth API
│   │       ├── conectarBaston() → abre selector BLE del navegador
│   │       ├── Intenta Nordic UART Service → fallback genérico
│   │       ├── _procesarLecturaBLE() → buffer + parse ASCII
│   │       ├── _normalizarCaravana() → limpia el string recibido
│   │       ├── Reconexión automática en 3s si se corta
│   │       └── simularLectura() → para desarrollo sin bastón
│   │
│   ├── sync.js             → Sincronización con Google Sheets
│   │       ├── inicializarSync() → listeners online/offline
│   │       ├── sincronizarPendientes() → itera sync_queue → POST
│   │       ├── _enviarAlServidor() → Google Apps Script o API propia
│   │       └── [Código Apps Script incluido en comentarios]
│   │
│   └── app.js              → Controlador principal
│           ├── registrarServiceWorker()
│           ├── configurarEventos() → todos los click handlers
│           ├── caravanaRecibida() → llena input + vibra + carga historial
│           ├── guardarRegistro() → valida → db → toast → limpia
│           ├── manejarCambioConectividad() → actualiza badges UI
│           └── mostrarToast() → notificaciones visuales
│
└── css/
    └── estilos.css         → UI adaptada para trabajo de campo
            ├── Botones: min-height 64px (uso con guantes)
            ├── Inputs: min-height 60px, font 20-32px
            ├── Input caravana: 26px bold, uppercase
            ├── Input peso: 32px bold, centrado
            ├── Alto contraste: verde oscuro / tierra / blanco
            ├── Toast notifications (confirmaciones visuales)
            ├── Flash verde al recibir lectura BLE
            ├── Dark mode automático (uso nocturno en campo)
            └── Landscape mode para pantalla en horizontal
```

---

## TABLAS DE BASE DE DATOS LOCAL (IndexedDB / Dexie)

```
TABLA: animales
┌──────────────────┬──────────┬──────────────────────────────┐
│ Campo            │ Tipo     │ Descripción                  │
├──────────────────┼──────────┼──────────────────────────────┤
│ id               │ auto int │ PK local                     │
│ uuid             │ string   │ UUID v4 (idempotencia)       │
│ caravana         │ string   │ ID único del animal (índice) │
│ categoria        │ string   │ vaca/toro/ternero/etc.       │
│ raza             │ string   │ Angus/Hereford/etc.          │
│ fecha_nacimiento │ string   │ ISO date (opcional)          │
│ sincronizado     │ int      │ 0=pendiente 1=ok 2=conflicto │
│ timestamp_local  │ int      │ Unix ms del dispositivo      │
│ device_id        │ string   │ UUID del celular/tablet      │
│ deleted          │ int      │ 0=activo 1=borrado (soft)    │
└──────────────────┴──────────┴──────────────────────────────┘

TABLA: registros_manga
┌──────────────────┬──────────┬──────────────────────────────┐
│ Campo            │ Tipo     │ Descripción                  │
├──────────────────┼──────────┼──────────────────────────────┤
│ id               │ auto int │ PK local                     │
│ uuid             │ string   │ UUID v4 (idempotencia)       │
│ caravana         │ string   │ FK → animales.caravana       │
│ animal_uuid      │ string   │ FK → animales.uuid           │
│ peso_kg          │ float    │ Peso en kilogramos           │
│ estado_sanitario │ string   │ sano/vacunado/tratamiento    │
│ vacuna_aplicada  │ string   │ Nombre vacuna o medicamento  │
│ medicamento      │ string   │ Detalle del tratamiento      │
│ dosis_ml         │ float    │ Dosis aplicada               │
│ observaciones    │ string   │ Notas libres del operador    │
│ operador         │ string   │ Nombre de quien cargó        │
│ fecha            │ string   │ "2024-06-15"                 │
│ hora             │ string   │ "14:32"                      │
│ sincronizado     │ int      │ 0=pendiente 1=ok 2=conflicto │
│ timestamp_local  │ int      │ Unix ms                      │
│ device_id        │ string   │ UUID del dispositivo         │
│ sync_intentos    │ int      │ Contador de reintentos       │
└──────────────────┴──────────┴──────────────────────────────┘

TABLA: sync_queue
┌──────────────────┬──────────┬──────────────────────────────┐
│ Campo            │ Tipo     │ Descripción                  │
├──────────────────┼──────────┼──────────────────────────────┤
│ id               │ auto int │ PK                           │
│ tabla            │ string   │ 'animales' o 'registros_...' │
│ registro_uuid    │ string   │ UUID del registro a enviar   │
│ operacion        │ string   │ INSERT / UPDATE / DELETE     │
│ payload          │ string   │ JSON del registro completo   │
│ timestamp        │ int      │ Cuándo se encoló             │
│ intentos         │ int      │ Cuántas veces falló          │
│ ultimo_error     │ string   │ Mensaje del último error     │
└──────────────────┴──────────┴──────────────────────────────┘
```

---

## FLUJO GOOGLE SHEETS (BACKEND GRATUITO)

```
Google Sheet
      │
      ├── Hoja "animales"
      │       Columnas: uuid | caravana | categoria | raza |
      │                 device_id | timestamp_local
      │
      └── Hoja "registros_manga"
              Columnas: uuid | caravana | peso_kg | categoria | raza |
                        estado_sanitario | vacuna_aplicada | observaciones |
                        operador | fecha | hora | device_id | timestamp_local

Google Apps Script (Web App publicada como URL pública)
      │
      ├── doPost(e)
      │       ├── Parsea JSON del body
      │       ├── Abre el Sheet por ID
      │       ├── Busca si ya existe el UUID (idempotencia)
      │       │       ├── Existe + timestamp nuevo > existente → UPDATE fila
      │       │       ├── Existe + diferencia < 60s → { conflicto: true }
      │       │       └── No existe → appendRow()
      │       └── Retorna { ok: true } o { ok: false, conflicto: true }
      │
      └── doGet(e)
              └── Health check: { status: 'ok' }
```

---

## ESTADOS POSIBLES DE LA APP

```
CONECTIVIDAD:
  ● Online          → red disponible, sync automática activa
  ○ Sin señal       → modo offline, guardado local únicamente
  ↑ Sincronizando   → enviando datos a Sheets en este momento

BLUETOOTH:
  Sin bastón        → solo carga manual de caravanas
  Buscando...       → diálogo BLE abierto, esperando selección
  🔵 Conectado      → bastón listo para escanear
  Reconectando...   → reconexión automática en curso
  Error             → fallo de conexión, acción requerida

REGISTROS:
  sincronizado: 0   → ○ guardado local, pendiente de sync
  sincronizado: 1   → ✓ enviado y confirmado en Sheets
  sincronizado: 2   → ⚠ conflicto detectado, revisión manual
```

---

## TECNOLOGÍAS Y POR QUÉ SE ELIGIERON

```
Vanilla JS (ES Modules)
      └── Sin build step en desarrollo, máximo rendimiento,
          sin dependencias que puedan quedar desactualizadas

Dexie.js → IndexedDB
      └── API promisificada sobre la DB nativa del navegador,
          soporta transacciones, índices y queries complejas,
          funciona 100% offline sin servidor

Workbox 7 (Google)
      └── Librería probada en producción para Service Workers,
          maneja Cache First, Network First y Background Sync
          con reintentos automáticos y expiración de caché

Web Bluetooth API
      └── Estándar nativo en Chrome/Android, permite conectar
          directamente al bastón sin instalar app nativa,
          funciona en HTTPS (GitHub Pages, Netlify)

Google Apps Script
      └── Serverless gratis, escribe directo en Google Sheets,
          el Sheet es el "dashboard" visual sin costo,
          URL pública actúa como endpoint REST simple
```
