# CONTEXTO TÉCNICO — RodeoApp Los Aromos
**Última actualización:** 2026-05-27  
**Repo:** https://github.com/juansineriz1-source/LosAromos  
**Cuenta GitHub:** juansineriz1-source  
**URL producción:** https://los-aromos.vercel.app  
**Directorio local:** `c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos\rodeo-pwa\`

---

## ⚠️ REGLAS CRÍTICAS QUE NO HAY QUE OLVIDAR

> Estas reglas vienen de errores reales. Leerlas ANTES de hacer cualquier cambio.

### 1. LÍMITE DE 12 FUNCIONES SERVERLESS EN VERCEL (Plan Hobby)
El plan gratuito de Vercel permite **máximo 12 funciones serverless** (archivos `.js` dentro de `/api`).  
**Si se agrega una función más, el deploy falla sin mensaje claro.**

**Estado actual (12/12 funciones):**
```
api/animales.js          ← FUNCIÓN CENTRAL — contiene múltiples modos (ver sección 6)
api/actualizar-animal.js
api/sincronizar.js
api/actividad.js
api/subir-media.js
api/subir-audio.js
api/media-proxy.js
api/upload-url.js
api/borrar-media.js
api/tareas.js
api/push-subscribe.js
api/push-notify.js
```
`cors-rodeo.json` en `/api` NO cuenta (no es función).

**¿Querés agregar una nueva API?** → Primero agregar un nuevo `modo` dentro de `animales.js` (GET o POST con body.modo). Solo si es imposible incorporarla ahí, considerar plan Pro.

### 2. SIEMPRE VERIFICAR SINTAXIS ANTES DE HACER PUSH
```powershell
node --check rodeo-pwa/api/animales.js
node --check rodeo-pwa/js/app.js
```
Hacerlo para TODOS los archivos tocados antes del commit.

### 3. NO TOCAR EL CSS SIN VER EL ARCHIVO PRIMERO
El CSS está en `rodeo-pwa/css/estilos.css` (4500+ líneas) y `rodeo-pwa/css/rodeo-chips.css`.  
**NO existe** `style.css` ni `rodeo-oficial.js` con funciones de inseminación — todo está en `app.js`.

### 4. LAS FUNCIONES DE INSEMINACIÓN Y VACUNACIÓN ESTÁN EN app.js
Las funciones `abrirRegistroInseminacion`, `inicializarVacunacion`, `inicializarInsMasiva` están en `app.js`, NO en `rodeo-oficial.js`. `rodeo-oficial.js` solo maneja el rodeo/lista.

### 5. EL SW.JS TIENE UN NÚMERO DE REVISION — ACTUALIZAR CON CADA DEPLOY
```powershell
# Buscar la revision actual:
Select-String "revision:" rodeo-pwa/sw.js
# Incrementar en 1 antes de cada git push
```

### 6. LAS RUTAS AL ARCHIVO CSS FALLAN A VECES POR CAPITALIZACIÓN
Siempre verificar con `Get-ChildItem` antes de buscar con grep. El archivo está en `css/estilos.css`.

### 7. VARIABLES DE ENTORNO NO SE PUEDEN DESCARGAR
`vercel env pull` no descarga las secretas. Si se necesita dev local, recrear `.env.local` manualmente desde el dashboard de Vercel.

---

## 1. QUÉ ES LA APP

PWA (Progressive Web App) offline-first para gestión ganadera del establecimiento **Los Aromos** (Corrientes, Argentina).  
Funciona en celular y computadora. El operario de campo (Domingo) graba audios de recorrida, saca fotos/videos de animales y registra novedades del día. Los admins (Juan, Ana, Juan F, Manuela) pueden editar el rodeo, ver todo el historial, gestionar tareas y sincronizar datos.

**Vet responsable del plan sanitario:** Med. Vet. Micone

---

## 2. ARQUITECTURA

```
[Browser / PWA]  ←→  [Vercel Serverless Functions /api/*]  ←→  [Google Sheets]
                                                            ←→  [MinIO NAS]
```

- **IndexedDB (Dexie.js)**: almacenamiento local offline-first
- **Google Sheets**: fuente de verdad para todos los datos estructurados del rodeo
- **MinIO**: almacenamiento de archivos binarios (audio, fotos, videos) en NAS local del establecimiento (`storage.losaromos.online`)
- **Vercel**: sirve la PWA estática + funciones serverless como proxy
- **Plan Hobby (gratuito)**: límite estricto de 12 serverless functions

---

## 3. VARIABLES DE ENTORNO EN VERCEL

Todas configuradas en Production + Preview del proyecto `los-aromos`.

| Variable | Valor / Descripción |
|---|---|
| `GOOGLE_SHEET_ID` | `1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `bot-n8n@custom-unison-403623.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Clave RS256 del service account (con `\n` escapados) |
| `S3_ENDPOINT` | `https://storage.losaromos.online` (sin slash final) |
| `S3_BUCKET` | `rodeo-aromos` |
| `S3_REGION` | `us-east-1` |
| `S3_ACCESS_KEY_ID` | Access key de MinIO |
| `S3_SECRET_ACCESS_KEY` | Secret key de MinIO |
| `VAPID_PUBLIC_KEY` | Push notifications — clave pública |
| `VAPID_PRIVATE_KEY` | Push notifications — clave privada |
| `VAPID_EMAIL` | `juansineriz1@gmail.com` |

> ⚠ Las env vars secretas **no se pueden descargar** con `vercel env pull`.  
> Para dev local, crear `.env.local` y pegar los valores manualmente desde el dashboard.

---

## 4. ESTRUCTURA DE ARCHIVOS CLAVE

```
rodeo-pwa/
├── index.html               # App shell — TODOS los tabs en un solo HTML (1200+ líneas)
├── sw.js                    # Service worker (cache PWA) — incrementar revision con cada deploy
├── manifest.json            # PWA manifest (iconos, nombre, tema)
├── js/
│   ├── app.js               # ARCHIVO PRINCIPAL — init, login, tabs, stats, vacunación, inseminación,
│   │                        # raspaduras, castraciones, panel inseminación, panel pesadas (2700+ líneas)
│   ├── rodeo-oficial.js     # Lista del rodeo, detalle animal, editor, filtros, sección vacunas en detalle
│   ├── inseminaciones.js    # Módulo de datos de inseminaciones (getInseminacionesData, registrarInseminacion)
│   ├── fotos-animal.js      # Galería de fotos por animal (vinculada a animal_uuid)
│   ├── calendario.js        # Feed de actividad del día + historial calendario
│   ├── recorrida.js         # Grabación de audio de recorrida
│   ├── fotos.js             # Subida de fotos (feed general)
│   ├── agenda.js            # Agenda de tareas (filtros, modal crear/completar)
│   ├── db.js                # IndexedDB con Dexie + lógica de sincronización local
│   ├── sync.js              # Sincronización pendientes → Sheets
│   ├── push.js              # Registro y gestión de push notifications
│   ├── videos.js            # Subida de videos
│   ├── vacunas.js           # Definición del plan sanitario Micone (vacunas y dropdowns)
│   ├── pesos-modulo.js      # (Legacy/alternativo) — La lógica real de pesadas está en app.js
│   └── bluetooth.js         # Integración bastón de lectura RFID/bluetooth
├── api/
│   ├── animales.js          # FUNCIÓN CENTRAL (12/12) — múltiples modos GET y POST
│   │                        #   GET modos: vacunas, historial-vacunas, pesos, inseminaciones, default(rodeo)
│   │                        #   POST modos: registro-vacuna, registro-inseminacion, registro-vacuna-masiva,
│   │                        #              registro-inseminacion-masiva, registro-peso
│   ├── actualizar-animal.js # POST — editar/agregar animal en hoja LosAromos
│   ├── sincronizar.js       # POST — sincronizar novedades/registros a Sheets (registros_manga)
│   ├── actividad.js         # GET — leer actividad remota (filtra DELETED)
│   ├── subir-media.js       # POST — subir foto/video a MinIO (proxy server-side)
│   ├── subir-audio.js       # POST — subir audio a MinIO (separado del media)
│   ├── media-proxy.js       # GET — proxy unificado para reproducir audio/video desde MinIO
│   ├── upload-url.js        # GET — genera presigned URL para upload directo a MinIO
│   ├── borrar-media.js      # POST — borrar archivo de MinIO + marcar DELETED en Sheets
│   ├── tareas.js            # GET/POST — gestión de tareas (hoja "Tareas" en Sheets)
│   ├── push-subscribe.js    # POST — registrar suscripción push (hoja "push_subs")
│   ├── push-notify.js       # POST — enviar notificación push a todos los dispositivos
│   └── cors-rodeo.json      # Configuración CORS para MinIO (referencia, NO es función serverless)
└── css/
    ├── estilos.css          # Estilos principales (~4500 líneas) — clases vac-, peso-, ins-, masiva-
    └── rodeo-chips.css      # Chips de tipo/estado del rodeo
```

---

## 5. TABS Y USUARIOS

### Tabs por rol
| Rol | Tabs disponibles |
|---|---|
| Admin (Juan, Ana, Juan F, Manuela) | Inicio · Bastón · Rodeo · Recorrida · (Agenda) |
| Operario (Domingo + otros) | Recorrida · Rodeo |

### Tab inicial por usuario
- **Admins** → Inicio
- **Operarios** → Recorrida
- **Domingo específicamente** → Recorrida (override explícito en `TAB_INICIAL_USUARIO`)

### Sistema de roles (login)
- Login por nombre libre (campo de texto)
- **Admin** si el nombre es: `juan`, `ana`, `manuela`, `juanf`, `juan f` (case-insensitive)
- **Operario** cualquier otro nombre → va directo a Recorrida

---

## 6. API ANIMALES.JS — MODOS DETALLADOS

Como está en el límite de funciones, `animales.js` es la función central que maneja múltiples endpoints:

### GET /api/animales
| Query param `modo` | Qué hace |
|---|---|
| *(sin modo)* | Devuelve todo el rodeo desde hoja `LosAromos` |
| `vacunas` | Devuelve todas las vacunaciones desde hoja `Vacunacion` |
| `historial-vacunas` | Devuelve historial de vacunas de un animal (requiere `boton` o `caravana`) |
| `pesos` | Devuelve pesos desde hoja `Pesos` (filtra por `caravana`/`boton` si se pasan, admite `limit`) |
| `inseminaciones` | Devuelve inseminaciones desde hoja `Inseminaciones` |

### POST /api/animales
| Body `modo` | Qué hace |
|---|---|
| `registro-vacuna` | Registra vacuna individual → hoja `Vacunacion` |
| `registro-inseminacion` | Registra inseminación individual → hoja `Inseminaciones` (calcula parto +283 días) |
| `registro-vacuna-masiva` | Batch de vacunas → hoja `Vacunacion` |
| `registro-inseminacion-masiva` | Batch de inseminaciones |
| `registro-peso` | Registra peso de un animal → hoja `Pesos` (A:H) |

---

## 7. HOJAS EN GOOGLE SHEETS

| Hoja | Contenido | Columnas |
|---|---|---|
| `LosAromos` | Rodeo maestro (una fila por animal) | boton, caravana, tipo, estado, color, campo, observaciones, uuid, etc. |
| `Historial` | Log de cada cambio de animal | — |
| `Vacunacion` | Registro de vacunaciones (A:O) | caravana, boton, categoria, vacuna, tipo_frecuencia, fecha_aplicacion, fecha_proxima, estado, dias_alerta, lote, veterinario, operador, observaciones, timestamp |
| `Inseminaciones` | Registro de inseminaciones | caravana, boton, fecha_inseminacion, semen_toro, metodo, fecha_parto_esperada, estado, observaciones, operador, timestamp |
| `Pesos` | Historial de pesadas | A=caravana, B=boton, C=tipo, D=fecha, E=peso_kg, F=observaciones, G=operador, H=timestamp |
| `registros_manga` | Registros del bastón (peso, sanidad, vacuna) | caravana, peso_kg, estado_sanitario, vacuna_aplicada, operador, fecha, etc. |
| `novedades` | Novedades del día (texto libre) | — |
| `fotos_meta` | Metadatos de fotos (storage_key, animal_uuid) | — |
| `videos_meta` | Metadatos de videos | — |
| `recorridas_meta` | Metadatos de audios de recorrida | — |
| `push_subs` | Suscripciones push por dispositivo | device_id, operador, endpoint, p256dh, auth, fecha, activo |
| `Tareas` | Agenda de tareas | titulo, descripcion, asignado, prioridad, estado, fecha_creacion, fecha_vencimiento, fecha_completado |

**Hojas creadas con el script `setup-3hojas.gs`** (Apps Script):  
`Inseminaciones`, `registros_manga`, `Tareas` (con formato y cabeceras correctas)

---

## 8. MÓDULOS DEL TAB RODEO (3 paneles)

### Estados por tipo de animal (rodeo-oficial.js)

| Tipo | Código | Estados disponibles |
|---|---|---|
| V, VQ, V1-V6, TH | Hembras | `P` Preñada · `V` Vacía · `I` Inseminada |
| T | Toro | `S` En servicio · `F` Fuera servicio · `D` Descartado |
| TM | Ternero Macho | `C` Castrado · `SC` Sin castrar |

> Los estados `E` (En engorde) y `R` (Retirado) fueron eliminados (reemplazados por `D` Descartado en Toros).  
> La función `estadosPorTipo(tipo)` en `rodeo-oficial.js` devuelve el array correcto según el tipo.

### Paneles de acción (botones superiores del tab)

Desde Mayo 2026, el tab Rodeo tiene 3 botones en la parte superior que abren paneles independientes:

```
[ 💉 Vacunación ]   [ 🐄 Inseminación ]   [ ⚖️ Pesadas ]   [ℹ️]
```

Abrir uno cierra los otros automáticamente.

### Panel Vacunación
- **Botón "⚡ Masiva"** → modal `modal-vac-masiva` (vacunación masiva con selección múltiple)
- Lista de animales con chips por categoría y buscador
- **ID botón apertura:** `btn-abrir-vacunacion`
- **ID panel:** `panel-vacunacion`
- **JS:** `inicializarVacunacion()` en `app.js:979`
- Incluye `inicializarRaspado()`, `inicializarCastracion()`, `inicializarInsMasiva()` al final

### Panel Inseminación (nuevo — separado de Vacunación)
- **Buscador** por botón/caravana → muestra card del animal
- Formulario: fecha, toro/semen, método (IA / IATF / SN), observaciones
- **Calculadora automática de parto** (+283 días desde fecha inseminación)
- **Lista de recientes** (últimas 8 inseminaciones) al pie
- **Botón "⚡ Masiva"** → abre `modal-ins-masiva` (inseminación masiva existente)
- **ID botón apertura:** `btn-abrir-inseminacion`
- **ID panel:** `panel-inseminacion`
- **JS:** `inicializarPanelInseminacion()` en `app.js`
- **API:** `POST /api/animales` con `modo: 'registro-inseminacion'`

### Panel Pesadas (nuevo)
Dos tabs: **Animal Individual** y **Pesada Grupal**

**Tab Individual:**
- Buscador → selecciona animal → muestra card (botón/caravana/tipo)
- Campos: peso en kg (grande, marrón), fecha, observaciones
- API: `POST /api/animales` con `modo: 'registro-peso'`

**Tab Grupal:**
- Selector de cantidad: botones **2·3·4·5·6** o campo manual
- Campo peso total → calcula automáticamente **peso por animal = total / N**
- Buscador para agregar animales al grupo (los identifica por caravana/botón)
- Cada animal se puede quitar individualmente con ✕
- Al guardar: registra el mismo kg calculado para CADA animal del grupo, con observación que indica "[Grupal N animales, total Xkg]"
- **ID botón apertura:** `btn-abrir-pesadas`
- **ID panel:** `panel-pesadas`
- **JS:** `inicializarPanelPesadas()` en `app.js`
- **API:** `POST /api/animales` con `modo: 'registro-peso'`

---

## 9. PLAN SANITARIO (vacunas.js — Med. Vet. Micone)

El archivo `js/vacunas.js` define todas las vacunas organizadas por categoría:

| Categoría | Vacunas |
|---|---|
| SENASA (obligatorias) | Fiebre Aftosa, Brucelosis (terneras 3-8 meses) |
| Vaca / Vaquillona | Triple Clostridial, Reproductiva (IBR+BVD+PI3+BRSV), Preparto (4-6 sem antes) |
| Terneros | Triple Clostridial, Carbunclo (zona endémica) |
| Toros | Triple Clostridial, Reproductiva (pretemporada) |
| Otras | Desparasitante (Ivermectina 1%), Cobre (suplemento) |

Los dropdowns en el modal de vacunación están organizados por estas categorías.

---

## 10. DISEÑO Y CSS

- **Paleta:** verde oscuro `#1a5c30` (acento principal), azul `#1d4ed8` (inseminación), marrón `#7c5c1e` (pesadas)
- **Tipografía:** Inter + Manrope (Google Fonts)
- **Componentes clave CSS:**
  - `.vac-btn-acceso` — botones de acceso a módulos (verde oscuro, flex:1)
  - `.vac-panel` / `.vac-panel-header` — estructura de los paneles
  - `.vac-btn-masiva` / `.vac-btn-cerrar` — botones dentro del header de panel
  - `.vac-modal-overlay` / `.vac-modal-card` — modales con blur de fondo
  - `.masiva-cat-btn` — chips de categoría en módulos masivos
  - `.peso-tab` — tabs Individual/Grupal en panel Pesadas
  - `.peso-grup-cant-btn` — botones de cantidad (2,3,4,5,6)
  - `.peso-animal-card` / `.peso-animal-card.seleccionado` — card de animal seleccionado
  - `.peso-grup-item` / `.peso-grup-sugerencia` — items del grupo y sugerencias de búsqueda
  - `.ins-animal-card` — card de animal para inseminación (azul)
  - `.btn-guardar-grande` — botón primario de guardado
  - `.campo-label` — etiquetas de formulario

---

## 11. FLUJO DE AUDIO (recorrida de campo)

```
[Celular graba audio]
  → MediaRecorder (32 kbps opus/webm — 75% más liviano que default)
  → Blob guardado en IndexedDB (tabla: recorridas)
  → Estado: "○ Local"

[Background upload]
  → Blob → base64
  → POST /api/subir-audio { tipo:'audio', base64, mimeType, operador }
    → Vercel: Buffer.from(base64,'base64') → AWS Sig v4 → PUT MinIO
  → IndexedDB actualiza: storage_url + storage_key
  → Estado: "☁ Subida"

[Reproducción de audio]
  Audio local  → blob URL (directo, instantáneo)
  Audio remoto → /api/media-proxy?key=recorrida/fecha/archivo.webm
               → Vercel fetch MinIO server-side (sin CORS)
               → Cache-Control: 24h
```

---

## 12. FLUJO DE FOTOS Y VIDEOS

**Fotos:** vinculadas a `animal_uuid` del animal (no al número de caravana/botón)
```
POST /api/subir-media { tipo:'foto', base64, mimeType, operador, animal_uuid }
```

**Videos:**
```
POST /api/subir-media { tipo:'video', ... }
MinIO: video/fecha/operador_timestamp.ext
Reproducción: <video> con src=/api/media-proxy?key=video/...
```

---

## 13. NOTIFICACIONES PUSH

- **Stack:** Web Push API + `web-push` npm (ESM import)
- **VAPID keys:** configuradas en Vercel
- **Flujo:**
  1. App llama `GET /api/push-subscribe` → recibe VAPID public key
  2. Browser suscribe al Push Manager
  3. App hace `POST /api/push-subscribe` con endpoint+keys → guarda en hoja `push_subs`
  4. Cuando alguien sube algo → `POST /api/push-notify` → envía a todos excepto al sender
- **Estado:** ✅ Funcionando
- **Reactivar banner:** `localStorage.removeItem('push_postponed'); location.reload();`

---

## 14. BORRADO DE MEDIA (admins)

- Solo admins ven el botón 🗑️ en el feed
- Al borrar:
  1. Card se elimina del DOM con animación fade+slide
  2. `storage_key` se guarda en `localStorage['rodeo_deleted_keys']`
  3. `POST /api/borrar-media` → elimina de MinIO + marca `DELETED` en Sheets
- Al refrescar: `GET /api/actividad` filtra filas con `storage_key === 'DELETED'`
- Doble protección: servidor (Sheets filtrado) + cliente (localStorage cache)

---

## 15. BASTÓN BLE (lectura de caravanas RFID)

- **UUIDs BLE:** Nordic UART Service (NUS) `6e400001-b5a3-f393-e0a9-e50e24dcca9e` → fallback genérico `0000ffe0-0000-1000-8000-00805f9b34fb`
- **Bastones compatibles:** Herdsman HR4 ✓, Tru-Test XRS2 ✓, Allflex RS420 (UUID propietario ⚠)
- Al leer caravana → `caravanaRecibida()` en `app.js` → llena input + vibración + foco salta a peso

### Formulario del Bastón (chips rediseñados — Mayo 2026)

| Campo | Tipo | Opciones |
|---|---|---|
| Categoría | Chips single-select | V, VQ, V1, V2, V3, V4, V5, V6, TH, TM, T, V CUT |
| Color | Chips single-select | ⚫ Negra, 🟠 Colorada |
| Vacuna | Chips multi-select | Aftosa, Brucelosis, Carbunclo, Mancha, Queratoconjuntivitis, Clostridiales, IBR+DVB+Lepto, Diarrea Neonatal, Otra |
| Estado sanitario | Select | Sano, Vacunado, En tratamiento, Cuarentena, Revisar |
| Peso | Input número | kg |
| Caravana | Input texto | puede venir del BLE o manual |

---

## 16. BUGS RESUELTOS

| Bug | Causa | Fix |
|---|---|---|
| Audio no se subía | `atob()` no es confiable en Node.js 18 | `Buffer.from(base64,'base64')` |
| Audio no se subía | mimeType con codecs rompía firma AWS | `mimeType.split(';')[0]` |
| Rodeo "sin conexión" | `_filtroTipo` no declarada → ReferenceError | `let _filtroTipo = 'todos'` |
| Videos reaparecían | Faltaba filtro DELETED en `actividad.js` | `.filter(obj => obj.storage_key !== 'DELETED')` |
| Push notifications no llegaban | Hoja `push_subs` no existía | `crearHojaConCabeceras()` vía batchUpdate |
| Filtros rodeo no funcionaban | `style.display` vs clase CSS con `display:none` | Usar solo `classList.add/remove('oculto')` |
| Botón filtros no respondía | Listener JS no enganchaba | `onclick` inline en HTML como fallback |
| **Deploy falla silenciosamente** | **13+ funciones en /api superan límite Vercel Hobby** | **Fusionar en animales.js con modos** |
| Inseminación masiva se perdió | `btn-abrir-ins-masiva` se movió al panel Inseminación | Botón ahora en header de `panel-inseminacion` |
| Toggle filtros abría y cerraba solo | `onclick` HTML + `addEventListener` JS = doble disparo | Eliminado `addEventListener`, dejado solo `onclick` en HTML |
| Chips de tipo no filtraban | `addEventListener` individual duplicaba el delegado del panel | Eliminados listeners individuales, solo event delegation |
| Tab Agenda completamente en blanco | `style="display:none"` inline bloqueaba clase `.oculto` | Removido style inline, solo `class="oculto"` |
| Contador buscador no actualizaba | `renderizarRodeo()` sobreescribía el contador de `aplicarFiltros()` | `renderizarRodeo` solo actualiza resumen con flag `actualizarResumen=true` |
| Bugs raros en usuarios con datos viejos | Storage local incompatible entre versiones | `APP_VERSION` en `app.js` — limpia storage automáticamente al detectar versión nueva |

---

## 17. PENDIENTES / PRÓXIMAS FUNCIONALIDADES

1. **Historial de pesos en detalle animal** — mostrar gráfico o lista de pesadas en el modal de detalle de cada animal
2. **Estado "Inseminada" automático** — cuando se registra una inseminación, actualizar el campo `estado` del animal en la hoja `LosAromos` a "Inseminada"
3. **Confirmar preñez / tacto** — interfaz para registrar el resultado del tacto rectal (preñada/vacía/dudosa)
4. **Dev local** — recrear `.env.local` con variables de entorno de producción (no se pueden descargar automáticamente de Vercel)
5. **videos.js** — verificar si aún usa lógica de presigned PUT o ya está migrado a `/api/subir-media`

### Sistema APP_VERSION (migración automática de storage)
En `app.js`, al inicio hay una IIFE que compara `localStorage['rodeo_app_version']` con `APP_VERSION`.  
Si no coincide → limpia caches SW + IndexedDB + localStorage (preservando sesión) → guarda nueva versión.  
**⚠️ Cada vez que haya cambios de estructura de datos, subir `APP_VERSION` en `app.js`.**  
Versions actual: `'53'` (último cambio Mayo 2026)

---

## 18. HISTORIAL DE COMMITS CLAVE

| Commit | Descripción |
|---|---|
| `3404594` | Buscador + tabs en vac.masiva e ins.masiva |
| `c60a6f7` | Buscador en panel vacunación individual |
| `7c1232b` | Inseminación en detalle animal + calculadora parto |
| `42a88a5` | Auditoría completa — fix filtros, chips tipo, galería fotos |
| `4ad7c45` | Fix TH→Ternera (crítico para Brucelosis), display:flex chips |
| `750b148` | Plan sanitario Micone — vacunas organizadas por categoría |
| `a8e59ab` | api/pesos.js — primer intento de endpoint separado (luego fusionado) |
| `1866503` | 3 módulos en Rodeo (Vacunación/Inseminación/Pesadas) — deploy falló por límite funciones |
| `57ed984` | **FIX: fusion pesos en animales.js** — solución al límite de 12 funciones |
| `3bf9da2` | Fix toggle filtros — eliminado addEventListener duplicado (doble disparo) |
| `8ef8e30` | Fix chips tipo — eliminado addEventListener individual que duplicaba el delegado |
| `2e9ce32` | Fix Agenda en blanco (style=display:none) + fix contador buscador |
| `7584052` | APP_VERSION migration system — limpia storage stale automáticamente |
| `82991d0` | Agrega memory.md — registro de errores y lecciones aprendidas |
| `88b8003` | Estados por tipo: Toro→S/F/D, TM→C/SC; elimina E(engorde) y R(retirado) |

---

## 19. COMANDOS ÚTILES

```powershell
# Deploy (automático via git push)
cd "c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos"
git add -A && git commit -m "mensaje" && git push

# ANTES DE PUSHEAR: siempre verificar sintaxis
node --check rodeo-pwa/api/animales.js
node --check rodeo-pwa/js/app.js

# Contar funciones en /api (no debe superar 12)
(Get-ChildItem "rodeo-pwa/api" -Filter "*.js").Count

# Incrementar revision del SW (buscar número actual y sumar 1)
Select-String "revision:" rodeo-pwa/sw.js

# Dev local (requiere .env.local con todas las variables)
cd rodeo-pwa
npx vercel dev --listen 3004

# Re-activar banner de push notifications (consola del browser)
localStorage.removeItem('push_postponed'); location.reload()

# Limpiar caché en la app
https://los-aromos.vercel.app/clear-cache.html
```

---

## 20. ARQUITECTURA CSS — JERARQUÍA DE CLASES NUEVAS (Mayo 2026)

### Panel Pesadas
```css
.peso-tab              /* Tab Individual / Grupal */
.peso-tab.activo       /* Tab activa */
.peso-grup-cant-btn    /* Botones 2·3·4·5·6 */
.peso-grup-cant-btn.activo  /* Botón de cantidad seleccionado */
.peso-animal-card      /* Card del animal encontrado */
.peso-animal-card.seleccionado  /* Animal seleccionado */
.peso-animal-id        /* Número de botón grande */
.peso-animal-car       /* Número de caravana */
.peso-no-result        /* Texto "no encontrado" */
.peso-grup-sugerencia  /* Ítem de búsqueda para agregar al grupo */
.peso-grup-item        /* Animal ya agregado al grupo */
.peso-grup-item-num    /* Número de orden (círculo) */
.peso-grup-item-info   /* Info del animal en el grupo */
.peso-grup-item-quitar /* Botón ✕ para quitar del grupo */
.peso-grup-empty       /* Texto cuando el grupo está vacío */
```

### Panel Inseminación
```css
.ins-animal-card       /* Card azul del animal a inseminar */
```

### Paneles (ya existían — referencia)
```css
.vac-btn-acceso        /* Botón de acceso a módulo (verde, flex:1) */
.vac-panel             /* Contenedor del panel (ocupa 100%) */
.vac-panel-header      /* Header verde del panel */
.vac-btn-masiva        /* Botón secundario en el header */
.vac-btn-cerrar        /* X para cerrar el panel */
.vac-input             /* Input estándar h:48px, border-radius:14px */
.vac-select            /* Select estándar */
.vac-textarea          /* Textarea h:80px */
.vac-ins-calc          /* Box calculadora de parto (verde claro) */
.btn-guardar-grande    /* Botón primario de guardado */
.campo-label           /* Etiqueta de campo de formulario */
```
