# CONTEXTO TÉCNICO — RodeoApp Los Aromos
**Última actualización:** 2026-05-18  
**Repo:** https://github.com/juansineriz1-source/LosAromos  
**URL producción:** https://los-aromos.vercel.app  
**Directorio local:** `c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos\rodeo-pwa\`

---

## 1. QUÉ ES LA APP

PWA (Progressive Web App) offline-first para gestión ganadera del establecimiento **Los Aromos**.  
Funciona en celular y computadora. El operario de campo (Domingo) graba audios de recorrida, saca fotos de animales y registra novedades del día. Los admins (Juan, Ana, Juan F, Manuela) pueden editar el rodeo, ver todo el historial y sincronizar datos.

---

## 2. ARQUITECTURA

```
[Browser / PWA]  ←→  [Vercel Serverless Functions /api/*]  ←→  [Google Sheets]
                                                            ←→  [MinIO NAS]
```

- **IndexedDB (Dexie.js)**: almacenamiento local offline-first
- **Google Sheets**: fuente de verdad para metadatos (rodeo, recorridas, fotos, novedades)
- **MinIO**: almacenamiento de archivos binarios (audio, fotos, videos)
- **Vercel**: sirve la PWA estática + funciones serverless como proxy

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
| `VAPID_PRIVATE_KEY` | Push notifications |
| `VAPID_EMAIL` | Push notifications |

---

## 4. ESTRUCTURA DE ARCHIVOS CLAVE

```
rodeo-pwa/
├── index.html               # App shell, todos los tabs en un solo HTML
├── sw.js                    # Service worker (cache PWA)
├── js/
│   ├── app.js               # Init, login, navegación, tabs, stats inicio
│   ├── calendario.js        # Feed de actividad del día + historial calendario
│   ├── recorrida.js         # Grabación de audio de recorrida
│   ├── fotos.js             # Subida de fotos
│   ├── fotos-animal.js      # Galería de fotos por animal (vinculada a UUID)
│   ├── rodeo-oficial.js     # Lista y edición del rodeo (desde Sheets)
│   ├── db.js                # IndexedDB con Dexie + sincronización
│   └── videos.js            # Subida de videos (⚠ aún usa lógica vieja)
├── api/
│   ├── animales.js          # GET /api/animales — lista rodeo desde Sheets
│   ├── actualizar-animal.js # POST — editar/agregar animal en Sheets
│   ├── sincronizar.js       # POST — sincronizar novedades/registros a Sheets
│   ├── actividad.js         # GET — leer actividad remota (recorridas, fotos)
│   ├── subir-media.js       # POST — subir audio/foto a MinIO (proxy server-side)
│   ├── media-proxy.js       # GET — proxy unificado para reproducir audio/video desde MinIO
│   └── audio.js             # GET — proxy de audio (legado, puede convivir)
└── css/
    ├── estilos.css          # Estilos principales
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

---

## 6. FLUJO DE AUDIO (recorrida de campo)

```
[Celular graba audio]
  → MediaRecorder (32 kbps opus/webm — 75% más liviano que default)
  → Blob guardado en IndexedDB (tabla: recorridas)
  → Estado: "○ Local"

[Background upload]
  → Blob → base64
  → POST /api/subir-media { tipo:'audio', base64, mimeType, operador }
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
  → Blob → base64
  → POST /api/subir-media { tipo:'foto', base64, mimeType, operador }
  → IndexedDB actualiza: storage_url + storage_key
  → Estado: "☁ Subida"

[En el feed]
  → <img> clickeable → abre lightbox pantalla completa
```

Las fotos están vinculadas al `animal_uuid` del animal (no al número de caravana/botón), por lo que siguen al animal aunque se cambie su identificación.

---

## 8. FLUJO DE VIDEOS

```
[Celular graba video]
  → Blob → POST /api/subir-media { tipo:'video', ... }
  → MinIO: video/fecha/operador_timestamp.ext

[En el feed]
  → <video controls> con src=/api/media-proxy?key=video/...
  → Proxy infiere Content-Type por extensión (.mov, .mp4, .3gp, etc.)
```

⚠ **videos.js** aún usa lógica antigua de presigned PUT. No está migrado a `/api/subir-media`. Pendiente.

---

## 9. RODEO OFICIAL

- Datos vienen de Google Sheets vía `GET /api/animales`
- **Chips de filtro por tipo**: V · VQ · V1..V6 · V CUT · TH · TM · T — clickeables, combinables con buscador de texto
- **Estados**: P (Preñada) · V (Vacía) · I (Inseminada)
- **Colores**: Negra ⚫ · Colorada 🟠
- **Edición**: solo admins, botón ✏️ por animal → modal → escribe nueva fila en Sheets (trazabilidad)
- **Alta de animal**: botón `+` flotante (solo admins) → modal con todos los campos

---

## 10. INICIO — STATS DEL RODEO

En el tab Inicio hay una card "🐄 Rodeo" que muestra en tiempo real:
- Total de animales
- Preñadas / Vacías / Inseminadas (con tarjetas coloreadas)
- Chips por tipo (V 161, VQ 23, etc.)

Se carga llamando a `/api/animales` al entrar al Inicio.

---

## 11. LIGHTBOX (fotos)

Al tocar cualquier foto en el feed se abre a pantalla completa con fondo oscuro.  
- Se cierra con ✕, tocando el fondo, o con Escape  
- Funciones globales: `window.abrirLightbox(src)` / `window.cerrarLightbox()`  
- Definidas en `rodeo-oficial.js`, usadas desde templates HTML en `calendario.js`

---

## 12. SINCRONIZACIÓN ENTRE DISPOSITIVOS

```
Dispositivo A guarda dato → IndexedDB local
  → POST /api/sincronizar → Google Sheets

Dispositivo B entra a la app
  → GET /api/actividad → lee Sheets → merge con IndexedDB local
  → Muestra datos del otro dispositivo con ícono 📡
```

**Campos sincronizados**: novedades del día, registros de manga, recorridas (metadatos + storage_key), fotos (metadatos + storage_key).

---

## 13. BUGS RESUELTOS EN ESTA SESIÓN

| Bug | Causa | Fix |
|---|---|---|
| Audio no se subía | `atob()` no es confiable en Node.js 18 | `Buffer.from(base64,'base64')` |
| Audio no se subía | mimeType `audio/webm;codecs=opus` rompía firma AWS | `mimeType.split(';')[0]` antes de firmar |
| Errores silenciosos | catch sin feedback visual | Toast de error visible con mensaje exacto |
| Rodeo "sin conexión" | `_filtroTipo` no declarada → ReferenceError crasheaba módulo | Agregar `let _filtroTipo = 'todos'` |
| Credenciales S3 | `S3_ACCESS_KEY_ID` tenía valor incorrecto en Vercel | Usuario actualizó en dashboard Vercel |
| Audio tardaba | Sin caché, re-descargaba cada vez | `Cache-Control: 86400` en proxy |

---

## 14. PENDIENTES / PRÓXIMOS PASOS

1. **Migrar `videos.js`** al nuevo endpoint `/api/subir-media` (actualmente usa presigned PUT viejo)
2. **Videos existentes** con UUID en el nombre: si no tienen `storage_key` en IndexedDB no se pueden reproducir vía proxy. Para videos nuevos ya funciona.
3. **Caché de audio en IndexedDB**: el usuario sugirió descargar y guardar el blob localmente por 24h. Implementable como tabla `media_cache` en Dexie con `{key, blob, timestamp}`. No implementado aún — el browser lo cachea automáticamente vía HTTP Cache, que es suficiente por ahora.
4. **CORS en MinIO**: si se configura CORS en la consola MinIO para `https://los-aromos.vercel.app`, se podría acceder directo sin proxy, simplificando la arquitectura. No es urgente.

---

## 15. COMANDOS ÚTILES

```bash
# Deploy (automático via git push)
cd "c:\Users\Admin\.gemini\antigravity\scratch\premium-landing-page\Los Aromos"
git add -A && git commit -m "mensaje" && git push

# Limpiar caché en la app (navegar a)
https://los-aromos.vercel.app/clear-cache.html

# Logs de funciones Vercel
https://vercel.com → proyecto los-aromos → Functions → subir-media / media-proxy
```
