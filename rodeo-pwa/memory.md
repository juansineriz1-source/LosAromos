# 🧠 Memory — Lecciones Aprendidas (Rodeo PWA)

> Este archivo NO es documentación del proyecto.
> Es un registro de errores cometidos, correcciones del usuario, y reglas que hay que recordar
> para no repetir los mismos problemas una y otra vez.

---

## ⚠️ REGLAS CRÍTICAS QUE NO SE PUEDEN OLVIDAR

### 0. Siempre actualizar CONTEXTO_TECNICO.md y memory.md al final de cada cambio
- El usuario lo pide explícitamente: actualizar ambos archivos después de CADA cambio
- `CONTEXTO_TECNICO.md` → cómo funciona el proyecto, estructura, lógica
- `memory.md` → errores cometidos, correcciones, lecciones aprendidas
- Ambos van en el mismo commit del push final

### 1. Vercel tiene límite de 12 funciones serverless en el plan gratuito
- Cada archivo dentro de `/api/` cuenta como 1 función
- Si se crean más de 12 archivos en `/api/`, el deploy falla
- **Solución:** Reutilizar funciones existentes con parámetros (`?modo=xxx`) en lugar de crear archivos nuevos
- Antes de crear cualquier archivo nuevo en `/api/`, contar cuántos hay y verificar que no se supere el límite
- Archivos actuales que ya existen: animales.js, sincronizar.js, subir-media.js, tareas.js, novedades.js, vacunas.js, etc.

### 2. Siempre revisar el código del subagente antes de hacer push
- Los subagentes en general rompen algo al hacer cambios — siempre revisar qué tocaron antes de pushear
- Nunca hacer push ciego de lo que genera un subagente

### 3. El Service Worker cachea agresivamente — siempre subir la revisión
- Cada vez que se modifica cualquier archivo JS, CSS o HTML, hay que subir el número de revisión en `sw.js`
- Si no se sube la revisión, los usuarios siguen viendo la versión vieja cacheada
- Formato: `revision: 'N'` donde N es el número actual + 1
- La revisión actual está en `sw.js` en el array `precacheAndRoute([...])`
- **Revisión actual: 70**

### 4. El `style="display:none"` inline bloquea las clases CSS
- El sistema de tabs usa solo la clase `.oculto` para mostrar/ocultar
- Si un elemento tiene `style="display:none"` inline, el CSS de la clase no puede sobreescribirlo (inline > class)
- **Bug real:** El tab Agenda estuvo invisible por tener `style="display:none"` en el HTML además de `class="oculto"`
- **Regla:** Nunca poner `style="display:none"` en tabs — solo usar `class="oculto"`

### 5. DEXIE: `.reverse().sortBy()` es un antipatrón
- En Dexie.js, `.reverse()` afecta el cursor de IndexedDB pero `.sortBy()` descarga en memoria y re-ordena ignorando el cursor.
- **Resultado:** la lista siempre viene en orden ascendente aunque se use `.reverse()` antes.
- **Corrección:** usar `.toArray()` + `.sort()` manual:
  ```js
  const registros = await db.tabla.where('campo').equals(valor).toArray();
  return registros.sort((a, b) => b.timestamp_local - a.timestamp_local);
  ```

### 6. Fechas con `new Date().toISOString()` devuelven UTC — usar TZ Argentina
- `new Date().toISOString().split('T')[0]` da la fecha en UTC (no local).
- En Argentina (UTC-3), a las 23:00 esto devuelve el día siguiente.
- **Siempre usar:**
  ```js
  const TZ = 'America/Argentina/Buenos_Aires';
  new Date().toLocaleDateString('en-CA', { timeZone: TZ });        // fecha YYYY-MM-DD
  new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }); // hora HH:mm
  ```

### 7. Los archivos JS nuevos deben agregarse al precache del SW
- Si se agrega un módulo JS nuevo (o se descubre que faltaba), **también hay que agregarlo al array `precacheAndRoute` en `sw.js`**.
- Sin precache, el archivo no estará disponible si el usuario va offline sin haberlo visitado.
- Lista actual completa en sw.js (rev 70): app.js, rodeo-oficial.js, vacunas.js, inseminaciones.js, db.js, bluetooth.js, sync.js, recorrida.js, fotos.js, fotos-animal.js, videos.js, push.js, calendario.js, pesos-modulo.js, agenda.js, rodeo-chips.css.

---

## 🐛 BUGS REPETIDOS Y SUS CAUSAS

### Bug: Event listeners que se llaman dos veces (doble disparo)
**Cómo pasó:**
- Se registraba el mismo handler en DOS lugares al mismo tiempo:
  1. `onclick="window._toggleFiltros()"` en el HTML
  2. `btnToggle.addEventListener('click', window._toggleFiltros)` en el JS
- Resultado: cada click ejecutaba la función dos veces → toggle abría y cerraba en el mismo click
- **También pasó** con los chips de tipo: tenían `addEventListener` individual + el nuevo listener delegado del panel → click agregaba el filtro y el segundo lo borraba inmediatamente

**Regla:** Antes de agregar un `addEventListener`, verificar si ya existe un `onclick` en el HTML para el mismo elemento. Nunca tener ambos.

**Solución definitiva para los filtros:** Un único `addEventListener` delegado en el contenedor padre (`panel-filtros`) que captura todos los clicks con `e.target.closest('[data-grupo]')`. Infalible porque:
- No importa cuándo se generaron los chips
- No puede haber duplicados
- Funciona aunque el DOM se reconstruya

### Bug: Una función sobreescribe el resultado de otra
**Cómo pasó (contador del buscador):**
- `aplicarFiltros()` actualizaba el contador correctamente a "X de 190"
- Inmediatamente después llamaba a `renderizarRodeo()` que sobreescribía el contador con el valor incorrecto
- Resultado: el contador siempre mostraba el valor incorrecto al final

**Regla:** Cuando dos funciones actualizan el mismo elemento del DOM, decidir cuál es la "dueña" y que la otra no lo toque. En este caso `aplicarFiltros` es dueña del contador.

### Bug: Storage corrupto entre versiones
**Cómo pasó:**
- Al deployar una nueva versión con cambios de estructura, los datos viejos en IndexedDB/localStorage quedaban incompatibles
- Resultado: la Agenda aparecía en blanco, el contador mostraba valores incorrectos
- Los usuarios con datos viejos veían bugs que con storage limpio no existían

**Solución implementada:** `APP_VERSION` en `app.js` — al arrancar la app compara la versión guardada en localStorage con la actual. Si no coincide, limpia automáticamente caches, IndexedDB y localStorage (preservando sesión). Cada deploy importante debe subir `APP_VERSION`.

### Bug: CSS bloqueante por `@import` de fuentes
**Cómo pasó:**
- El CSS tenía `@import url('https://fonts.googleapis.com/...')` al inicio.
- Los `@import` en CSS son bloqueantes: el browser descarga el CSS, lo parsea, encuentra el `@import`, hace otra petición, y solo entonces sigue renderizando.

**Corrección:** Mover las fuentes a `<link rel="stylesheet">` en el `<head>` del HTML, con `<link rel="preconnect">` previos. Así las peticiones se hacen en paralelo con el CSS principal.

---

## ✅ PATRONES QUE FUNCIONAN BIEN

### Event delegation para filtros/chips
En lugar de poner `addEventListener` en cada chip individual:
```js
// MAL — listener en cada elemento
document.querySelectorAll('[data-grupo="estado"]').forEach(btn => {
  btn.addEventListener('click', () => { ... });
});

// BIEN — un solo listener delegado en el contenedor
panel.addEventListener('click', e => {
  const btn = e.target.closest('[data-grupo]');
  if (!btn) return;
  const grupo = btn.dataset.grupo;
  // manejar todos los grupos acá
});
```

### Chips con `data-grupo` + `data-val`
- Todos los chips de filtro tienen `data-grupo="tipo|estado|vacuna|periodo|vac-toggle"` y `data-val="..."`
- El listener delegado detecta el grupo y actúa en consecuencia
- Para agregar un nuevo tipo de filtro: solo agregar el `data-grupo` al HTML, el listener ya lo captura

### Chips visuales en bastón
- Categoría y Color: single-select (un solo chip activo a la vez)
- Vacunas: multi-select (varios chips activos, se concatenan en el textbox)
- El valor seleccionado se guarda en un `<input type="hidden">` para que `guardarRegistro()` lo lea

### Carga de scripts pesados bajo demanda
```js
// Patrón para cargar una lib solo cuando se necesita (ej: jsPDF)
async function cargarLibSiNoEsta(src) {
  return new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
```

### Fechas en Argentina (no UTC)
```js
const TZ = 'America/Argentina/Buenos_Aires';
const fecha = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // "2026-05-28"
const hora  = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }); // "23:45"
```

---

## 📋 CHECKLIST ANTES DE CADA PUSH

- [ ] ¿Se subió la revisión en `sw.js`? (revisión actual: 70)
- [ ] ¿Se corrió `node --check` en los archivos JS modificados?
- [ ] ¿Se revisó el código si lo generó un subagente?
- [ ] ¿Se creó algún archivo nuevo en `/api/`? Si sí, ¿cuántos hay ahora en total? ¿Más de 12?
- [ ] ¿Se agregó algún `addEventListener` que ya existía como `onclick` en el HTML?
- [ ] Si hubo cambios de estructura en datos, ¿se subió `APP_VERSION` en `app.js`?
- [ ] Si se agrega un JS nuevo, ¿se agregó al precache del `sw.js`?
- [ ] ¿Las fechas nuevas usan TZ Argentina (no `toISOString()`)?
- [ ] ¿Se actualizó `CONTEXTO_TECNICO.md` y este `memory.md`?

---

## 📅 Historial de correcciones

| Fecha | Error | Corrección |
|---|---|---|
| 2026-05 | Filtros de chips no funcionaban | Reescritura con event delegation en el panel contenedor |
| 2026-05 | Toggle de filtros abría y cerraba solo | Eliminado addEventListener duplicado (ya existía onclick en HTML) |
| 2026-05 | Chips de tipo no filtraban | Eliminado addEventListener individual que duplicaba el delegado |
| 2026-05 | Tab Agenda completamente en blanco | Removido `style="display:none"` del HTML del tab |
| 2026-05 | Contador buscador no actualizaba | `renderizarRodeo()` sobreescribía el contador de `aplicarFiltros()` |
| 2026-05 | Bugs de storage entre versiones | Implementado sistema de migración automática con `APP_VERSION` |
| 2026-05 | CATEGORIAS eran strings planos | Cambiadas a objetos `{ valor, label }` con los códigos reales del rodeo (V/VQ/V1-V6/TH/TM/T) |
| 2026-05-27 | Toros tenían estados E(engorde) y R(retirado) | Ahora: Toro→S/F/D(descartado); TM→C(castrado)/SC(sin castrar) |
| 2026-05-27 | No se actualizaban los docs después de cambios | Regla: siempre actualizar CONTEXTO_TECNICO.md + memory.md en cada commit |
| 2026-05-27 | Wrappers desktop rompen layout mobile | Usar `display:contents` en mobile para que sean invisibles; sobreescribir en media query |
| 2026-05-27 | Paneles se abrían full-screen en desktop | `inicializarDesktopPanels()` usa MutationObserver para moverlos al panel derecho |
| 2026-05-28 | CSS bloqueaba render por @import de fuentes | Movido a `<link>` en HTML con `preconnect` |
| 2026-05-28 | `historialAnimal` devolvía orden ascendente | `.reverse().sortBy()` antipatrón Dexie → corregido a `.toArray().sort()` |
| 2026-05-28 | Fecha de registro manga con día equivocado (noche ARG) | `toISOString()` = UTC → corregido a TZ Argentina |
| 2026-05-28 | 3 módulos JS faltaban en precache SW | Agregados `pesos-modulo.js`, `fotos-animal.js`, `agenda.js`, `rodeo-chips.css` al precache |
| 2026-05-28 | Datos del rodeo en blanco offline | `/api/*` sin estrategia de caché en SW → agregado `NetworkFirst` (8s timeout, 24h caché) |
| 2026-05-30 | Tab bastón y otros tabs en BLANCO en desktop | `body { max-width:480px }` mobile nunca se sobreescribía en `@media (min-width:1024px)` → agregado `max-width: none` + `padding-bottom: 0` al body en el media query |
| 2026-05-30 | Variables CSS faltantes en producción (`--texto-principal`, `--verde`, etc.) | Variables alias ya existían localmente; `--texto-principal` faltaba → agregada en `:root` |
| 2026-05-30 | Recorrida tab sin layout desktop | No tenía wrapper `recorrida-desktop-cols` en HTML → agregados wrappers + CSS grid `1fr 1fr` |
| 2026-05-30 | CSS `baston-desktop-cols` anidado erróneamente dentro de `.rodeo-breakdown-item {}` | Se detectó nesting CSS inválido en línea ~3668. El bloque correcto ahora está en el media query `@media (min-width:1024px)` al final del archivo |

### BUG CR�TICO 2026-05-30: </section> faltante rompe todos los tabs desktop
- **Problema:** Al restructurar 	ab-inicio con inicio-desktop-cols, se olvid� agregar el </section> que cierra 	ab-inicio. El navegador interpreta autom�ticamente que todos los tabs siguientes (bast�n, rodeo, recorrida, agenda) son hijos de 	ab-inicio. Como 	ab-inicio es el �nico hijo del .main, los otros tabs tienen offsetWidth: 0, offsetHeight: 0 y aparecen en blanco.
- **S�ntoma:** Todos los tabs excepto Inicio aparecen completamente en blanco en desktop. El debug mostraba mainChildren.length: 1 con solo 	ab-inicio.
- **Fix:** Agregar </section><!-- /tab-inicio --> INMEDIATAMENTE ANTES del comentario del siguiente tab.
- **Regla:** Siempre que se restructure HTML que envuelve sections, verificar el cierre de todas las sections. Usar Select-String -Pattern "<section|</section>" para auditar.
- **Tiempo perdido:** ~2 horas de debugging de CSS (variables, max-width, margin, flex) buscando la causa en el CSS cuando el bug era puramente HTML.

