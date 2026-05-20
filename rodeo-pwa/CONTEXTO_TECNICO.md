# CONTEXTO TÉCNICO — RodeoApp Los Aromos
**Última actualización:** 2026-05-20  
**Repo:** https://github.com/juansineriz1-source/LosAromos  
**Cuenta GitHub:** juansineriz1-source  
**URL producción:** https://los-aromos.vercel.app  
**Directorio local:** `c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos\rodeo-pwa\`

---

## 1. QUÉ ES LA APP

PWA (Progressive Web App) offline-first para gestión ganadera del establecimiento **Los Aromos**.  
Funciona en celular y computadora. El operario de campo (Domingo) graba audios de recorrida, saca fotos/videos de animales y registra novedades del día. Los admins (Juan, Ana, Juan F, Manuela) pueden editar el rodeo, ver todo el historial, gestionar tareas y sincronizar datos.

---

## 2. ARQUITECTURA

```
[Browser / PWA]  ←→  [Vercel Serverless Functions /api/*]  ←→  [Google Sheets]
                                                            ←→  [MinIO NAS]
```

- **IndexedDB (Dexie.js)**: almacenamiento local offline-first
- **Google Sheets**: fuente de verdad para metadatos (rodeo, recorridas, fotos, novedades, tareas, historial de vacunas)
- **MinIO**: almacenamiento de archivos binarios (audio, fotos, videos) en NAS local
- **Vercel**: sirve la PWA estática + funciones serverless como proxy (límite 12 funciones en plan Hobby)

---

## 3. VARIABLES DE ENTORNO EN VERCEL (todas configuradas en Production + Preview)

| Variable | Descripción |
|---|---|
| `GOOGLE_SHEET_ID` | ID del Google Sheet principal |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email del service account |
| `GOOGLE_PRIVATE_KEY` | Private key del service account |
| `S3_ENDPOINT` | `https://storage.losaromos.online` (sin slash final) |
| `S3_BUCKET` | `rodeo-aromos` |
| `S3_REGION` | `us-east-1` |
| `S3_ACCESS_KEY_ID` | Access key de MinIO |
| `S3_SECRET_ACCESS_KEY` | Secret key de MinIO |
| `VAPID_PUBLIC_KEY` | Push notifications — pública |
| `VAPID_PRIVATE_KEY` | Push notifications — privada |
| `VAPID_EMAIL` | Push notifications — email (`juansineriz1@gmail.com`) |

> ⚠ Las env vars secretas **no se pueden descargar** con `vercel env pull` (seguridad de Vercel).  
> Para dev local, crear `.env.local` y pegar los valores manualmente desde el dashboard.

---

## 4. ESTRUCTURA DE ARCHIVOS CLAVE

```
rodeo-pwa/
├── index.html               # App shell, todos los tabs en un solo HTML
├── sw.js                    # Service worker (cache PWA)
├── manifest.json            # PWA manifest (iconos, nombre, tema)
├── js/
│   ├── app.js               # Init, login, navegación, tabs, stats inicio
│   ├── calendario.js        # Feed de actividad del día + historial calendario
│   ├── recorrida.js         # Grabación de audio de recorrida
│   ├── fotos.js             # Subida de fotos
│   ├── fotos-animal.js      # Galería de fotos por animal (vinculada a UUID)
│   ├── rodeo-oficial.js     # Lista y edición del rodeo (Sheets) + detalle expandible + vacunas
│   ├── agenda.js            # Agenda de tareas (con filtros, modal crear/completar)
│   ├── db.js                # IndexedDB con Dexie + sincronización
│   ├── sync.js              # Lógica de sincronización con Sheets
│   ├── push.js              # Registro y gestión de push notifications
│   ├── videos.js            # Subida de videos
│   └── bluetooth.js         # Integración bastón de lectura RFID/bluetooth
├── api/
│   ├── animales.js          # GET /api/animales — lista rodeo desde Sheets
│   ├── actualizar-animal.js # POST — editar/agregar animal + vacunas + historial
│   ├── sincronizar.js       # POST — sincronizar novedades/registros a Sheets
│   ├── actividad.js         # GET — leer actividad remota (filtra DELETED)
│   ├── subir-media.js       # POST — subir foto/video a MinIO (proxy server-side)
│   ├── subir-audio.js       # POST — subir audio a MinIO (separado del media)
│   ├── media-proxy.js       # GET — proxy unificado para reproducir audio/video desde MinIO
│   ├── upload-url.js        # GET — genera presigned URL para upload directo a MinIO
│   ├── borrar-media.js      # POST — borrar archivo de MinIO + marcar DELETED en Sheets
│   ├── tareas.js            # GET/POST — gestión de tareas (hoja "Tareas" en Sheets)
│   ├── push-subscribe.js    # POST — registrar suscripción push (hoja "push_subs")
│   ├── push-notify.js       # POST — enviar notificación push a todos los dispositivos
│   └── cors-rodeo.json      # Configuración CORS para MinIO (referencia)
└── css/
    ├── estilos.css          # Estilos principales (Apple redesign)
    └── rodeo-chips.css      # Chips de tipo/estado del rodeo
```

---

## 5. TABS Y USUARIOS

### Tabs por rol
| Rol | Tabs disponibles |
|---|---|
| Admin (Juan, Ana, Juan F, Manuela) | Inicio · Bastón · Rodeo · Recorrida |
| Operario (Domingo + otros) | Recorrida · Rodeo |

**Tab Manual fue eliminada** — el alta de animales se hace desde el botón `+` en Rodeo.

### Tab inicial por usuario
- **Admins** → Inicio
- **Operarios** → Recorrida
- **Domingo específicamente** → Recorrida (override explícito en `TAB_INICIAL_USUARIO`)

### Sistema de roles (login)
- Login por nombre libre (campo de texto — sin botones preset)
- **Admin** si el nombre es: `juan`, `ana`, `manuela`, `juanf`, `juan f` (case-insensitive)
- **Operario** cualquier otro nombre → va directo a Recorrida

---

## 6. FLUJO DE AUDIO (recorrida de campo)

```
[Celular graba audio]
  → MediaRecorder (32 kbps opus/webm — 75% más liviano que default)
  → Blob guardado en IndexedDB (tabla: recorridas)
  → Estado: "○ Local"

[Background upload]
  → Blob → base64
  → POST /api/subir-audio { tipo:'audio', base64, mimeType, operador }
    → Vercel: Buffer.from(base64,'base64') → AWS Sig v4 → PUT MinIO
    → MinIO devuelve 200
  → IndexedDB actualiza: storage_url + storage_key
  → Estado: "☁ Subida"

[Sincronización metadatos]
  → POST /api/sincronizar → escribe fila en sheet 'recorridas_meta'
  → Otro dispositivo lo ve via GET /api/actividad
```

### Reproducción de audio
```
Audio local → blob URL (directo, instantáneo)
Audio remoto → /api/media-proxy?key=recorrida/fecha/archivo.webm
             → Vercel fetch MinIO server-side (sin CORS)
             → Cache-Control: 24h (browser cachea automáticamente)
```

---

## 7. FLUJO DE FOTOS

```
[Celular saca foto]
  → Blob guardado en IndexedDB (tabla: fotos) vinculada a animal_uuid
  → Estado: "○ Local"

[Background upload]
  → POST /api/subir-media { tipo:'foto', base64, mimeType, operador }
  → IndexedDB actualiza: storage_url + storage_key
  → Estado: "☁ Subida"

[En el feed]
  → <img> clickeable → abre lightbox pantalla completa
```

Las fotos están vinculadas al `animal_uuid` del animal (no al número de caravana/botón).

---

## 8. FLUJO DE VIDEOS

```
[Celular graba video]
  → POST /api/subir-media { tipo:'video', ... }
  → MinIO: video/fecha/operador_timestamp.ext

[En el feed]
  → <video controls> con src=/api/media-proxy?key=video/...
  → Proxy infiere Content-Type por extensión (.mov, .mp4, .3gp, etc.)
  → Card de video: fondo oscuro, overflow:hidden, object-fit:contain
```

---

## 9. RODEO OFICIAL

- Datos vienen de Google Sheets vía `GET /api/animales`
- **Chips de filtro por tipo**: V · VQ · V1..V6 · V CUT · TH · TM · T
- **Estados**: P (Preñada) · V (Vacía) · I (Inseminada)
- **Colores**: Negra ⚫ · Colorada 🟠
- **Tocar card → modal detalle expandible:**
  - Operarios: solo lectura (todos los campos)
  - Admins: va directo al editor
- **Edición** (admins): modal con todos los campos → escribe nueva fila en Sheets (historial)
- **Alta de animal**: botón `+` flotante (solo admins)
- **Vacunas**: desde el modal de detalle/edición se puede registrar vacunas con fecha y dosis múltiples
- **Historial de cambios**: cada edición queda logueada en hoja "Historial"

### Hojas en Google Sheets
| Hoja | Contenido |
|---|---|
| `LosAromos` | Rodeo maestro (una fila por animal — se actualiza) |
| `Historial` | Log de cada cambio de animal |
| `Vacunas` | Registro histórico de vacunaciones |
| `recorridas_meta` | Metadatos de recorridas de audio |
| `novedades` | Novedades del día |
| `fotos_meta` | Metadatos de fotos |
| `videos_meta` | Metadatos de videos |
| `push_subs` | Suscripciones push por dispositivo (device_id, operador, endpoint, p256dh, auth, fecha, activo) |
| `Tareas` | Agenda de tareas (título, descripción, asignado, prioridad, estado, fechas) |

---

## 10. AGENDA DE TAREAS

- Nueva funcionalidad agregada en commit `06332e7`
- API: `GET/POST /api/tareas` → hoja "Tareas" en Sheets
- UI: `js/agenda.js` — filtros por estado (Pendiente/Completada/Todas), modal crear, modal completar
- Roles:
  - **Admin**: puede crear, editar, completar y ver todas
  - **Operario**: puede ver asignadas a él y completarlas

---

## 11. NOTIFICACIONES PUSH

- **Stack**: Web Push API + `web-push` npm package (ESM import)
- **VAPID keys**: configuradas en Vercel (pública + privada + email)
- **Flujo**:
  1. App llama `GET /api/push-subscribe` → recibe VAPID public key
  2. Browser suscribe al Push Manager
  3. App hace `POST /api/push-subscribe` con endpoint+keys → se guarda en hoja `push_subs`
  4. Cuando alguien sube algo → `POST /api/push-notify` → envia a todos excepto al sender
- **Estado**: ✅ Funcionando (fix: hoja `push_subs` debe existir con cabeceras correctas)
- **Cache de borrados**: `localStorage['rodeo_deleted_keys']` — cuando se borra un item, su `storage_key` se guarda localmente para que no reaparezca aunque Sheets falle

---

## 12. BORRADO DE MEDIA (admins)

- Solo admins (Juan, Ana, Manuela, Juan F) ven el botón 🗑️ en el feed
- Al borrar:
  1. Card se elimina del DOM con animación fade+slide
  2. `storage_key` se guarda en `localStorage['rodeo_deleted_keys']`
  3. `POST /api/borrar-media` → elimina archivo de MinIO + marca fila en Sheets como `DELETED`
- Al refrescar: `GET /api/actividad` filtra filas con `storage_key === 'DELETED'`
- Doble protección: servidor (Sheets filtrado) + cliente (localStorage cache)

---

## 13. SINCRONIZACIÓN ENTRE DISPOSITIVOS

```
Dispositivo A guarda dato → IndexedDB local
  → POST /api/sincronizar → Google Sheets

Dispositivo B entra a la app
  → GET /api/actividad → lee Sheets → merge con IndexedDB local
  → Muestra datos del otro dispositivo con ícono 📡
```

---

## 14. DISEÑO (Apple Redesign — Mayo 2026)

- Tokens iOS: colores, radios, sombras
- Header con glassmorphism
- Nav blur
- Cards refinadas con sombra suave
- Botones estilo iOS (border-radius, fuente SF-like)
- Inputs con fondo opaco y borde sutil
- Toast en formato pill (centrado, bordes redondeados)
- Modal con blur de fondo
- Login con gradiente verde

---

## 15. BUGS RESUELTOS

| Bug | Causa | Fix |
|---|---|---|
| Audio no se subía | `atob()` no es confiable en Node.js 18 | `Buffer.from(base64,'base64')` |
| Audio no se subía | mimeType `audio/webm;codecs=opus` rompía firma AWS | `mimeType.split(';')[0]` |
| Rodeo "sin conexión" | `_filtroTipo` no declarada → ReferenceError | `let _filtroTipo = 'todos'` |
| Videos reaparecían al refrescar | Faltaba filtro DELETED en `actividad.js` | Añadido `.filter(obj => obj.storage_key !== 'DELETED')` |
| Card de video desbordaba | Sin `overflow:hidden` en contenedor | CSS corregido + `object-fit:contain` |
| Push notifications sin llegar | Hoja `push_subs` no existía en Sheets | Usuario crea hoja manualmente con cabeceras |
| push-subscribe guardaba `ok:true` sin escribir | `append` a hoja inexistente falla silencioso | `crearHojaConCabeceras()` vía batchUpdate |
| Variables de entorno locales perdidas | `vercel env pull` pisó `.env.local` existente | Recrear manualmente desde dashboard |

---

## 16. LÍMITES DEL PLAN VERCEL HOBBY

- **Máximo 12 serverless functions** — se consolidaron funciones para no superar el límite:
  - `vacunar` fusionado en `actualizar-animal`
  - `audio.js` legado eliminado
- Si se necesitan más funciones → evaluar plan Pro o consolidar más endpoints

---

## 17. PENDIENTES

1. **Dev local**: recrear `.env.local` con las variables de entorno de producción (no se pueden descargar automáticamente de Vercel)
2. **videos.js**: verificar si aún usa lógica de presigned PUT o ya está migrado
3. **CORS en MinIO**: si se configura para `https://los-aromos.vercel.app`, se podría acceder directo sin proxy
4. **Caché de media en IndexedDB**: el browser lo cachea vía HTTP Cache (suficiente por ahora)

---

## 18. COMANDOS ÚTILES

```bash
# Deploy (automático via git push)
cd "c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos"
git add -A && git commit -m "mensaje" && git push

# Dev local (requiere .env.local con todas las variables)
cd "c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos\rodeo-pwa"
npx vercel dev --listen 3004

# Limpiar caché en la app (navegar a)
https://los-aromos.vercel.app/clear-cache.html

# Logs de funciones Vercel
https://vercel.com → proyecto losaromos → Functions → subir-media / media-proxy

# Re-activar banner de push notifications (consola del browser)
localStorage.removeItem('push_postponed'); location.reload();
```
