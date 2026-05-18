# RodeoApp — Contexto Técnico Completo
**Última actualización:** 2026-05-18 | **Estado:** Producción activa con bugs pendientes en sync de media

---

## 1. Qué es la app

**RodeoApp** es una PWA (Progressive Web App) offline-first para gestión de ganado vacuno de la estancia **Los Aromos** en Argentina.

- **URL producción:** https://los-aromos.vercel.app
- **Repositorio:** https://github.com/juansineriz1-source/LosAromos
- **Hosting:** Vercel (serverless functions + static)
- **Storage binario:** MinIO self-hosted en `https://storage.losaromos.online` (bucket: `rodeo-aromos`)
- **Base de datos de texto:** Google Sheets (ID: `1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg`)
- **Auth Google Sheets:** Service Account `bot-n8n@custom-unison-403623.iam.gserviceaccount.com`

---

## 2. Usuarios y roles

| Usuario | Rol | Acceso |
|---------|-----|--------|
| Juan | Admin | Todo |
| Ana | Admin | Todo |
| Juan F | Admin | Todo |
| Manuela | Admin | Todo |
| Domingo | Operario | Solo lectura en Rodeo, puede grabar y anotar |

Los roles se definen hardcodeados en `js/app.js` (`USUARIOS` array). No hay autenticación real — el usuario elige su nombre al entrar.

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (PWA)                            │
│  - IndexedDB (Dexie.js): "RodeoDB_v4"                       │
│  - Service Worker (sw.js): caché offline                    │
│  - Módulos ES6 en js/                                       │
└──────────────┬──────────────────────────────────────────────┘
               │  fetch()
       ┌───────┴────────┐
       │  Vercel API    │  (serverless functions en /api/)
       └───────┬────────┘
       ┌───────┴────────┐
       │ Google Sheets  │  ← texto, metadata, historial
       │ MinIO NAS      │  ← audio, fotos, videos (binarios)
       └────────────────┘
```

### Flujo de datos por tipo:

| Tipo de dato | Guardado local | Sube a | Cross-device via |
|---|---|---|---|
| Novedades/texto | IndexedDB `novedades` | Google Sheets (hoja `novedades`) | `/api/actividad?fecha=YYYY-MM-DD` |
| Registros manga | IndexedDB `registros_manga` | Google Sheets (hoja `registros_manga`) | `/api/actividad` |
| Audio recorridas | IndexedDB `recorridas` (blob) | MinIO (`audio/YYYY-MM-DD/op_ts.webm`) | hoja `recorridas_meta` en Sheets |
| Fotos | IndexedDB `fotos` (blob) | MinIO (`foto/YYYY-MM-DD/op_ts.jpg`) | hoja `fotos_meta` en Sheets |
| Videos | IndexedDB `videos` (blob) | MinIO (`video/YYYY-MM-DD/op_ts.mp4`) | hoja `videos_meta` en Sheets |
| Rodeo oficial | No en IndexedDB | Google Sheets (hoja `Hoja1`) | `/api/animales` |

---

## 4. Estructura de archivos

### Frontend (`js/`)
```
app.js           — Punto de entrada. Inicialización, navegación entre tabs, 
                   saludos, estadísticas del día. Contiene USUARIOS con roles.
db.js            — Schema IndexedDB (Dexie). RodeoDB_v4 con 2 versiones:
                   v1: animales, registros_manga, sync_queue, config, novedades,
                       recorridas, fotos, videos
                   v2: + fotos_animal (fotos vinculadas a animales por UUID estable)
                   También exporta: crearMetadatos(), guardarNovedad(), 
                   contarPendientes(), encolarSync(), marcarComoSincronizado()
sync.js          — Sincronización de sync_queue a Sheets via /api/sincronizar.
                   sincronizarPendientes() procesa la cola al reconectar.
                   sincronizarMedia() envía metadata de media a Sheets.
calendario.js    — Tab "Inicio": feed de actividad del día + historial mensual.
                   Mezcla datos locales + remotos (via /api/actividad).
                   fetchActividadRemota() trae datos de Sheets.
                   Audio remoto se carga via /api/audio?key=... (proxy CORS).
recorrida.js     — Grabación de audio (MediaRecorder API).
                   subirAudioEnBackground() convierte blob→base64 y POST a 
                   /api/subir-media → MinIO server-side.
fotos.js         — Captura/selección de fotos, compresión (max 1200px, 82%).
                   subirFotoEnBackground() usa /api/subir-media igual que audio.
videos.js        — Selección de videos, subida igual que fotos.
rodeo-oficial.js — Tab "Rodeo": lista de animales del Google Sheet.
                   Edición de Botón, Caravana, Estado (P/V/I), Tipo, Color.
                   Galería de fotos por animal via fotos-animal.js.
fotos-animal.js  — Fotos vinculadas a animales. Usa animal_uuid estable en 
                   localStorage (persiste aunque cambie Botón/Caravana).
bluetooth.js     — Integración con bastón electrónico Bluetooth.
push.js          — Notificaciones push (web-push).
```

### Backend API (`api/`)
```
animales.js         — GET /api/animales
                      Lee hoja "Hoja1" del Sheet. Devuelve todos los animales
                      del rodeo con columnas: boton, caravana, estado, tipo, 
                      color, fecha, tiene_caravana, tiene_boton, comentario,
                      + columnas L-O (historial de cambios).

actualizar-animal.js — POST /api/actualizar-animal
                       Agrega nueva fila en Sheets con el animal editado 
                       (append-only para trazabilidad). Usa columnas L-O para
                       guardar valores anteriores.

actividad.js        — GET /api/actividad?fecha=YYYY-MM-DD
                      Lee hojas: registros_manga, novedades, recorridas_meta,
                      fotos_meta, videos_meta.
                      Devuelve: { registros, novedades, recorridas, fotos, videos }
                      Timezone por defecto: Argentina (UTC-3).

sincronizar.js      — POST /api/sincronizar
                      Body: { tabla, accion: "UPSERT", datos, clave_idempotencia }
                      Tablas soportadas: animales, registros_manga, novedades,
                      recorridas_meta, fotos_meta, videos_meta.
                      AUTO-CREA la pestaña en Sheets si no existe (batchUpdate addSheet).
                      Last-Write-Wins por timestamp_local.

subir-media.js      — POST /api/subir-media  ← PRINCIPAL para uploads
                      Body JSON: { tipo, base64, mimeType, operador }
                      tipo: "audio" | "foto" | "video"
                      Firma PUT con AWS Signature v4 y sube a MinIO SERVER-SIDE.
                      Devuelve: { ok, publicUrl, objectKey }
                      SIN CORS issues porque corre en Vercel, no en el browser.

audio.js            — GET /api/audio?key=recorrida/YYYY-MM-DD/op_ts.webm
                      Proxy para reproducir audio de MinIO sin CORS.
                      Soporta Range requests (scrubbing del reproductor).

upload-url.js       — POST /api/upload-url (DEPRECADO para uploads directos)
                      Genera presigned PUT URLs. YA NO SE USA para subir 
                      porque el browser tiene CORS issues con MinIO.
                      Puede eliminarse en el futuro.

subir-audio.js      — POST /api/subir-audio (DEPRECADO, reemplazado por subir-media)
                      Puede eliminarse.

push-notify.js      — POST /api/push-notify — envía notificaciones push
push-subscribe.js   — POST /api/push-subscribe — registra subscripciones push
```

### CSS (`css/`)
```
estilos.css      — Estilos globales: variables CSS, dark mode, componentes base
rodeo-chips.css  — Chips de estado/tipo/color del rodeo + galería de fotos por animal
```

---

## 5. Variables de entorno en Vercel

```
GOOGLE_SHEET_ID              = 1tEncjxGzwE-7AZLnlmShSSM3lCaNFQR9DNn459AWhSg
GOOGLE_SERVICE_ACCOUNT_EMAIL = bot-n8n@custom-unison-403623.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY           = -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----

S3_ENDPOINT                  = https://storage.losaromos.online
S3_BUCKET                    = rodeo-aromos
S3_ACCESS_KEY_ID             = (generado en consola MinIO)
S3_SECRET_ACCESS_KEY         = (generado en consola MinIO)
S3_REGION                    = us-east-1
```

**IMPORTANTE:** En desarrollo local (`vercel dev`), estas variables deben configurarse 
en el entorno "Development" del dashboard de Vercel, o en `.env.local`.

---

## 6. Google Sheets — estructura de hojas

| Hoja | Propósito | Columnas clave |
|------|-----------|----------------|
| `Hoja1` | Rodeo oficial (animales) | A:boton, B:caravana, C:estado, D:tipo, E:color, F:tiene_caravana, G:tiene_boton, H:comentario, I:fecha, J:operador, K:device_id, L:boton_viejo, M:caravana_vieja, N:estado_viejo, O:tipo_viejo |
| `registros_manga` | Pesajes en manga | uuid, caravana, animal_uuid, peso_kg, estado_sanitario, vacuna_aplicada, operador, fecha, hora, ... |
| `novedades` | Comentarios/texto diario | uuid, fecha, hora, texto, operador, caravana, device_id |
| `recorridas_meta` | Metadata de audios grabados | uuid, fecha, hora, operador, duracion_seg, storage_url, storage_key, audio_tipo, audio_size, timestamp_local, device_id |
| `fotos_meta` | Metadata de fotos | uuid, fecha, hora, operador, nombre_original, storage_url, storage_key, imagen_tipo, imagen_size, timestamp_local, device_id |
| `videos_meta` | Metadata de videos | uuid, fecha, hora, operador, nombre_original, storage_url, storage_key, video_tipo, video_size, timestamp_local, device_id |

**IMPORTANTE:** Las hojas `recorridas_meta`, `fotos_meta`, `videos_meta` se crean 
automáticamente por `/api/sincronizar` la primera vez que se sube media. 
Si no existen todavía, `/api/actividad` devuelve arrays vacíos para esos tipos.

---

## 7. Flujo completo de un audio grabado

```
1. Usuario presiona "Grabar" en la tab Recorrida
2. MediaRecorder graba → chunks → Blob (audio/webm o audio/ogg según browser)
3. Usuario presiona "Guardar recorrida"
4. guardarRecorrida() en recorrida.js:
   a. Guarda en IndexedDB (db.recorridas) con { fecha, hora, duracion_seg, audio_blob, storage_url: null }
      IMPORTANTE: captura blobParaSubir = blobActual ANTES de llamar descartarRecorrida()
      (descartarRecorrida() pone blobActual = null)
   b. Muestra toast "✓ Recorrida guardada"
   c. Llama descartarRecorrida() → limpia UI, blobActual = null
   d. En background: subirAudioEnBackground(id, blobParaSubir, operador, onToast)

5. subirAudioEnBackground():
   a. Convierte blob → base64 con FileReader.readAsDataURL()
   b. POST /api/subir-media { tipo:"audio", base64, mimeType, operador }
   c. Vercel firma PUT con AWS Signature v4 y sube a MinIO
      objectKey: "audio/YYYY-MM-DD/op_timestamp.webm"
   d. Recibe { ok: true, publicUrl, objectKey }
   e. Actualiza IndexedDB: db.recorridas.update(id, { storage_url, storage_key })
   f. Llama sincronizarMedia('recorrida', registro) → POST /api/sincronizar 
      con tabla "recorridas_meta" (sin el blob, solo metadata)
   g. /api/sincronizar crea la pestaña si no existe, hace UPSERT

6. Otro dispositivo recarga "Actividad de hoy":
   a. cargarFeedHoy() llama fetchActividadRemota(fecha)
   b. GET /api/actividad?fecha=2026-05-18 → lee hoja recorridas_meta → devuelve { storage_url, storage_key }
   c. El reproductor usa proxyUrl = /api/audio?key=audio/2026-05-18/juan_123.webm
   d. /api/audio fetcha de MinIO server-side y sirve el binario con headers correctos
```

---

## 8. Bugs conocidos y estado actual

### ✅ Resueltos en esta sesión
| Bug | Fix aplicado |
|-----|-------------|
| Timezone UTC vs Argentina | Todas las fechas usan `toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })` |
| `blobActual = null` antes de subir | Se captura `blobParaSubir = blobActual` antes de `descartarRecorrida()` |
| CORS MinIO en uploads (PUT) | Browser ya no hace PUT directo; va via `/api/subir-media` server-side |
| CORS MinIO en reproducción (GET) | Audio se sirve via `/api/audio?key=...` proxy server-side |
| Pestañas inexistentes en Sheets | `/api/sincronizar` crea automáticamente via `batchUpdate addSheet` |
| `leerHoja` lanzaba error 400 | Ahora devuelve `[]` en 400/404 (pestaña no existe) |
| Novedades no se sincronizaban | `guardarNovedad()` ahora llama `encolarSync()` |
| `fetchActividadRemota` incompleto | Ahora devuelve objeto completo con todos los arrays |
| `contarPendientes` incompleto | Ahora incluye novedades en el conteo |

### 🔴 Bug actual pendiente: audio y fotos quedan en "Local"
**Síntoma:** Después de grabar audio o tomar foto, el item muestra "○ Local" en lugar de "☁ Subida".

**Diagnóstico posible:**
- `/api/subir-media` puede estar fallando silenciosamente
- El catch en `subirAudioEnBackground` traga el error con solo `console.warn`
- **Próximo paso:** Agregar toast de error visible en la UI cuando falla la subida, 
  para saber el mensaje exacto del error
- Verificar en Vercel Dashboard → Functions → subir-media → logs si hay errores

**Cómo debuggear:**
1. Abrir https://los-aromos.vercel.app
2. F12 → Console
3. Grabar audio, guardar
4. Ver si aparece algún error en consola que empiece con `[Recorrida] Subida fallida:`
5. O ir a https://vercel.com → proyecto los-aromos → Functions → ver logs de `/api/subir-media`

---

## 9. IndexedDB — Schema (RodeoDB_v4)

**Versión 1:**
- `animales`: ++id, uuid, caravana, categoria, raza, fecha_nacimiento, sincronizado, timestamp_local, device_id, deleted
- `registros_manga`: ++id, uuid, caravana, animal_uuid, peso_kg, estado_sanitario, vacuna_aplicada, medicamento, dosis_ml, observaciones, operador, fecha, hora, sincronizado, timestamp_local, device_id, sync_intentos
- `sync_queue`: ++id, tabla, registro_uuid, operacion, payload, timestamp, intentos, ultimo_error
- `config`: &clave, valor
- `novedades`: ++id, uuid, fecha, hora, texto, operador, caravana, sincronizado, timestamp_local, device_id
- `recorridas`: ++id, uuid, fecha, hora, duracion_seg, operador, audio_blob, audio_tipo, audio_size, storage_url, storage_key, timestamp_local, device_id
- `fotos`: ++id, uuid, fecha, hora, operador, imagen_blob, imagen_tipo, imagen_size, nombre_original, storage_url, storage_key, timestamp_local, device_id
- `videos`: ++id, uuid, fecha, hora, operador, video_blob, video_tipo, video_size, nombre_original, storage_url, storage_key, timestamp_local, device_id

**Versión 2 (agrega):**
- `fotos_animal`: ++id, uuid, animal_uuid, boton_al_guardar, caravana_al_guardar, fecha, hora, operador, imagen_blob, imagen_tipo, imagen_size, storage_url, storage_key, timestamp_local, device_id, sincronizado

---

## 10. Rodeo Oficial — lógica de edición

- **Estado:** P (Preñada) | V (Vacía) | I (Inseminada)
- **Tipo:** V | VQ | V1 | V2 | V3 | V4 | V5 | V6 | V CUT | TH | TM | T
- **Color:** Negra | Colorada

Cada edición agrega una **nueva fila** en `Hoja1` (nunca modifica las anteriores).
Las columnas L-O guardan los valores anteriores para trazabilidad:
- L: boton_viejo, M: caravana_vieja, N: estado_viejo, O: tipo_viejo

**Fotos por animal:** Cada animal tiene un `animal_uuid` estable guardado en `localStorage`
bajo la clave `auid_<boton>_<caravana>`. Si cambia el botón o caravana, las fotos 
anteriores siguen accesibles porque están keyed por el UUID, no por los identificadores.

---

## 11. Utilidad clear-cache.html

**URL:** https://los-aromos.vercel.app/clear-cache.html

Limpia:
1. Service Worker cache (todas las versiones)
2. localStorage
3. IndexedDB (RodeoDB_v4 y versiones anteriores)
4. Refresca la página

**Usar siempre** después de deployar cambios que afecten sw.js o el schema de IndexedDB.

---

## 12. Deploy

```bash
# El proyecto se deploya automáticamente desde main en GitHub
# Para deploy manual:
git add -A
git commit -m "descripcion"
git push  # → Vercel detecta el push y deploya en ~2 minutos
```

---

## 13. Próximos pasos sugeridos

1. **Debuggear upload de media:** Agregar toast visible de error en `subirAudioEnBackground` 
   y `subirFotoEnBackground` para que el usuario vea el mensaje exacto del fallo.
   También verificar los logs de Vercel Functions.

2. **Verificar env vars en Vercel:** Confirmar que `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` 
   están configuradas en Vercel Production (no solo Development).

3. **Test de AWS Signature v4:** El endpoint `/api/subir-media` implementa AWS Sig v4 
   manualmente. Si MinIO usa una configuración especial (path-style vs virtual-hosted),
   puede necesitar ajuste en cómo se construye la URL canónica.

4. **Configurar CORS en MinIO:** Si es posible acceder a la consola MinIO, configurar 
   CORS para permitir GET desde `https://los-aromos.vercel.app`. Esto permitiría
   reproducir audios/fotos directamente sin el proxy Vercel (mejor performance).

5. **Sync de videos:** `videos.js` todavía usa presigned PUT directo (CORS bloqueado).
   Debería actualizarse igual que fotos.js y recorrida.js para usar `/api/subir-media`.
