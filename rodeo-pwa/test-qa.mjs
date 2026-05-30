/**
 * test-qa.mjs — RodeoApp QA v3 — Vercel Production
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL   = 'https://los-aromos.vercel.app';
const SS_DIR     = join(__dirname, 'qa-screenshots');
mkdirSync(SS_DIR, { recursive: true });

const results     = [];
const console404s = [];
const consoleErrs = [];
let browser, page;

const log = (test, status, detail = '') => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${test}] ${detail}`);
  results.push({ test, status, detail });
};

const wait = ms => new Promise(r => setTimeout(r, ms));

const ss = async name => {
  try { await page.screenshot({ path: join(SS_DIR, `${name}.png`) }); } catch {}
};

const clickTab = async tabId => {
  await page.evaluate(id => {
    const btn = document.getElementById(`nav-${id}`);
    if (btn) btn.click();
  }, tabId);
  await wait(800);
};

const isTabVisible = tabId => page.evaluate(id => {
  const el = document.getElementById(`tab-${id}`);
  return !!(el && !el.classList.contains('oculto') && el.style.display !== 'none');
}, tabId);

const click = async selector => {
  try { await page.click(selector); await wait(200); return true; } catch { return false; }
};

const typeIn = async (selector, text) => {
  try {
    await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (el) { el.value = ''; el.focus(); }
    }, selector);
    await page.type(selector, text, { delay: 40 });
    return await page.$eval(selector, el => el.value);
  } catch { return null; }
};

async function run() {
  console.log(`\n🧪 RodeoApp QA — ${BASE_URL}\n`);

  browser = await puppeteer.launch({
    headless: false,
    args: ['--window-size=430,932', '--no-sandbox'],
    defaultViewport: { width: 390, height: 844 },
  });

  page = await browser.newPage();

  page.on('response', r => { if (r.status() === 404) console404s.push(r.url()); });
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', e => consoleErrs.push(e.message));

  // Inyectar credenciales antes de que cargue la página
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('rodeo_operador', 'Juan');
    localStorage.setItem('rodeo_rol', 'admin');
    localStorage.setItem('rodeo_app_version', '53');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 1: Carga + estructura
  // ════════════════════════════════════════════════════════════════
  console.log('📋 TEST 1: Carga inicial');
  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(2000);

  log('T1.1 Título', (await page.title()) === 'RodeoApp' ? 'PASS' : 'WARN', await page.title());
  log('T1.2 Bottom Nav', (await page.$('.bottom-nav')) ? 'PASS' : 'FAIL');
  log('T1.3 5 Nav items', (await page.$$('.nav-item')).length === 5 ? 'PASS' : 'FAIL',
      `${(await page.$$('.nav-item')).length} items`);
  log('T1.4 Sin login overlay', !(await page.$('#login-overlay')) ? 'PASS' : 'FAIL');

  const opText = await page.$eval('#operador-nombre', el => el.textContent.trim()).catch(() => '');
  log('T1.5 Operador header', opText ? 'PASS' : 'WARN', `"${opText}"`);

  await ss('01-carga');

  // ════════════════════════════════════════════════════════════════
  // TEST 2: CSS Variables (diseño)
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 2: CSS Variables');
  const vars = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return ['--verde-ui','--gris','--verde-claro','--azul-bt','--verde',
            '--verde-oscuro','--texto-principal','--bg-card'].reduce((acc, v) => {
      acc[v] = s.getPropertyValue(v).trim(); return acc;
    }, {});
  });
  for (const [k, v] of Object.entries(vars))
    log(`T2 CSS ${k}`, v ? 'PASS' : 'FAIL', v || '⚠️ VACÍA — UI rota');

  // ════════════════════════════════════════════════════════════════
  // TEST 3: Tab INICIO
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 3: Tab INICIO');
  log('T3.1 Inicio visible', await isTabVisible('inicio') ? 'PASS' : 'FAIL');
  log('T3.2 Hero', (await page.$('.inicio-hero')) ? 'PASS' : 'WARN');

  const statsVals = await page.evaluate(() => ({
    registros:  document.getElementById('stat-registros')?.textContent.trim() ?? null,
    animales:   document.getElementById('stat-animales')?.textContent.trim()  ?? null,
    pendientes: document.getElementById('stat-pendientes')?.textContent.trim() ?? null,
    saludo:     document.getElementById('inicio-saludo')?.textContent.trim() ?? null,
    fecha:      document.getElementById('inicio-fecha')?.textContent.trim() ?? null,
  }));
  log('T3.3 Stat registros',   statsVals.registros   !== null ? 'PASS' : 'WARN', statsVals.registros  ?? 'null');
  log('T3.4 Stat animales',    statsVals.animales    !== null ? 'PASS' : 'WARN', statsVals.animales   ?? 'null');
  log('T3.5 Stat pendientes',  statsVals.pendientes  !== null ? 'PASS' : 'WARN', statsVals.pendientes ?? 'null');
  log('T3.6 Saludo dinámico',  statsVals.saludo      ? 'PASS' : 'WARN', statsVals.saludo  ?? '');
  log('T3.7 Fecha Argentina',  statsVals.fecha       ? 'PASS' : 'WARN', statsVals.fecha   ?? '');
  await ss('03-inicio');

  // ════════════════════════════════════════════════════════════════
  // TEST 4: Navegación entre las 5 tabs
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 4: Navegación de tabs');
  for (const tabId of ['baston','rodeo','recorrida','agenda','inicio']) {
    await clickTab(tabId);
    const vis    = await isTabVisible(tabId);
    const active = await page.evaluate(id => document.getElementById(`nav-${id}`)?.classList.contains('active'), tabId);
    const display= await page.evaluate(id => getComputedStyle(document.getElementById(`nav-${id}`) ?? document.body).display, tabId);
    log(`T4 ${tabId} visible`, vis ? 'PASS' : 'FAIL', display === 'none' ? 'nav-btn oculto!' : '');
    log(`T4 ${tabId} active`,  active ? 'PASS' : 'WARN');
    await ss(`04-tab-${tabId}`);
  }

  // ════════════════════════════════════════════════════════════════
  // TEST 5: Bastón — formulario
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 5: Tab BASTÓN');
  await clickTab('baston');
  await wait(500);
  log('T5.0 Bastón visible', await isTabVisible('baston') ? 'PASS' : 'FAIL');

  // Estado BT
  const estadoBT = await page.evaluate(() => document.getElementById('estado-bt')?.textContent.trim() ?? '');
  log('T5.1 Estado BT', estadoBT ? 'PASS' : 'WARN', `"${estadoBT}"`);

  const btnBT = await page.$('#btn-bluetooth');
  log('T5.2 Btn Bluetooth existe', btnBT ? 'PASS' : 'FAIL');

  // Formulario
  const caravanaVal = await typeIn('#input-caravana', 'QA001');
  log('T5.3 Input caravana', caravanaVal ? 'PASS' : 'FAIL', `"${caravanaVal}"`);

  const pesoVal = await typeIn('#input-peso', '420');
  log('T5.4 Input peso', pesoVal === '420' ? 'PASS' : 'FAIL', `"${pesoVal}"`);

  const chipCat = await page.evaluate(() => {
    const c = document.querySelector('#chips-categoria .manga-chip');
    if (c) { c.click(); return c.textContent.trim(); } return null;
  });
  log('T5.5 Chip categoría', chipCat ? 'PASS' : 'WARN', chipCat ?? 'no encontrado');

  // Guardar
  await page.evaluate(() => {
    document.getElementById('input-caravana').value = 'QA001';
    document.getElementById('input-peso').value = '420';
    document.getElementById('input-caravana').dispatchEvent(new Event('input'));
    document.getElementById('input-peso').dispatchEvent(new Event('input'));
  });
  await wait(200);
  const saved = await click('#btn-guardar');
  log('T5.6 Click guardar', saved ? 'PASS' : 'FAIL');
  await wait(800);

  const toast = await page.evaluate(() => {
    const t = document.querySelector('.toast-item, .toast, [class*="toast"]');
    return t?.textContent.trim().substring(0, 60) ?? null;
  });
  log('T5.7 Toast post-guardado', toast ? 'PASS' : 'WARN', toast ?? 'no detectado');
  await ss('05-baston');

  // ════════════════════════════════════════════════════════════════
  // TEST 6: Rodeo
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 6: Tab RODEO');
  await clickTab('rodeo');
  await wait(1500);
  log('T6.0 Rodeo visible', await isTabVisible('rodeo') ? 'PASS' : 'FAIL');

  const resumen = await page.$eval('#rodeo-oficial-resumen', el => el.textContent.trim()).catch(() => '');
  log('T6.1 Resumen cargado', resumen ? 'PASS' : 'WARN', resumen.substring(0, 60));

  const busqVal = await typeIn('#rodeo-of-buscar', 'A');
  log('T6.2 Búsqueda', busqVal !== null ? 'PASS' : 'FAIL', `"${busqVal}"`);
  await wait(400);

  const items = (await page.$$('.rodeo-item')).length;
  log('T6.3 Items en lista', true, `${items} items`);

  await click('#btn-toggle-filtros');
  await wait(400);
  const filtrosVis = await page.evaluate(() => {
    const p = document.getElementById('panel-filtros');
    return !!(p && p.style.display !== 'none');
  });
  log('T6.4 Toggle filtros', filtrosVis ? 'PASS' : 'WARN');
  await click('#btn-toggle-filtros');
  await wait(300);

  if (items > 0) {
    await page.evaluate(() => document.querySelector('.rodeo-item')?.click());
    await wait(700);
    const modalVis = await page.evaluate(() => {
      const m = document.getElementById('modal-overlay');
      return !!(m && !m.classList.contains('oculto'));
    });
    log('T6.5 Modal animal', modalVis ? 'PASS' : 'WARN');
    if (modalVis) { await click('#modal-cerrar, .modal-cerrar'); await wait(300); }
  }

  await ss('06-rodeo');

  // ════════════════════════════════════════════════════════════════
  // TEST 7: Recorrida
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 7: Tab RECORRIDA');
  await clickTab('recorrida');
  await wait(700);
  log('T7.0 Recorrida visible', await isTabVisible('recorrida') ? 'PASS' : 'FAIL');

  const recButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => /grab|record|🎙|🔴|audio/i.test(b.textContent + b.id))
      .map(b => b.id || b.textContent.trim().substring(0, 20))
  );
  log('T7.1 Btns grabación', recButtons.length > 0 ? 'PASS' : 'WARN', recButtons.join(' | ') || 'ninguno');

  const fotoButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => /foto|📷|photo/i.test(b.textContent + b.id))
      .map(b => b.id || b.textContent.trim().substring(0, 20))
  );
  log('T7.2 Btns foto', fotoButtons.length > 0 ? 'PASS' : 'WARN', fotoButtons.join(' | ') || 'ninguno');

  await ss('07-recorrida');

  // ════════════════════════════════════════════════════════════════
  // TEST 8: Agenda
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 8: Tab AGENDA');
  await clickTab('agenda');
  await wait(800);
  log('T8.0 Agenda visible', await isTabVisible('agenda') ? 'PASS' : 'FAIL');
  log('T8.1 Header agenda', (await page.$('.agenda-header')) ? 'PASS' : 'FAIL');

  const filtroCount = (await page.$$('.agenda-filtro-btn')).length;
  log('T8.2 Filtros agenda', filtroCount >= 3 ? 'PASS' : 'WARN', `${filtroCount} filtros`);

  const btnNueva = await page.evaluate(() => {
    const b = document.getElementById('btn-nueva-tarea');
    return b ? getComputedStyle(b).display !== 'none' : false;
  });
  log('T8.3 Btn nueva tarea', btnNueva ? 'PASS' : 'WARN', btnNueva ? 'visible (admin ok)' : 'oculto');
  await ss('08-agenda');

  // ════════════════════════════════════════════════════════════════
  // TEST 9: Performance + 404s + errores
  // ════════════════════════════════════════════════════════════════
  console.log('\n📋 TEST 9: Performance + errores');
  const metrics = await page.metrics();
  log('T9.1 Heap JS', metrics.JSHeapUsedSize < 50e6 ? 'PASS' : 'WARN',
      `${Math.round(metrics.JSHeapUsedSize / 1e6)} MB`);

  const api404s   = console404s.filter(u => u.includes('/api/'));
  const asset404s = console404s.filter(u => !u.includes('/api/'));
  const critErrs  = consoleErrs.filter(e =>
    !e.includes('/api/') && !e.includes('favicon') &&
    !e.includes('sw.js') && !e.includes('net::ERR') &&
    !e.includes('serviceWorker') && !e.includes('push') &&
    !e.includes('lh3.google')
  );

  log('T9.2 Asset 404s', asset404s.length === 0 ? 'PASS' : 'FAIL',
    asset404s.length > 0 ? asset404s.map(u => u.split('/').pop()).join(', ') : 'ninguno ✅');
  log('T9.3 API 404s (serverless)', api404s.length > 0 ? 'WARN' : 'PASS',
    api404s.length > 0 ? `${api404s.length} endpoints (verificar deploy)` : 'todas ok');
  
  if (critErrs.length === 0) {
    log('T9.4 Errores JS', 'PASS', 'ninguno ✅');
  } else {
    critErrs.slice(0, 5).forEach(e => log('T9.4 Error JS', 'FAIL', e.substring(0, 120)));
  }

  // ════════════════════════════════════════════════════════════════
  // Screenshots finales de todas las tabs
  // ════════════════════════════════════════════════════════════════
  for (const t of ['inicio','baston','rodeo','recorrida','agenda']) {
    await clickTab(t); await wait(600); await ss(`10-final-${t}`);
  }

  // ════════════════════════════════════════════════════════════════
  // REPORTE
  // ════════════════════════════════════════════════════════════════
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const score  = Math.round((passed / total) * 100);

  const report = `# RodeoApp QA — ${BASE_URL}
Fecha: ${new Date().toLocaleString('es-AR')}

## Score: ${score}/100 — ${passed}✅ ${failed}❌ ${warned}⚠️ / ${total} tests

## Resultados
${results.map(r => {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
  return `${icon} **${r.test}** — ${r.detail}`;
}).join('\n')}

## 404s de Assets (bugs reales)
${asset404s.map(u => `- ${u}`).join('\n') || '- Ninguno ✅'}

## 404s de APIs
${api404s.map(u => `- ${u}`).join('\n') || '- Ninguna'}

## Errores JS críticos
${critErrs.map(e => `- ${e}`).join('\n') || '- Ninguno ✅'}
`;
  writeFileSync(join(__dirname, 'qa-report.md'), report);

  console.log('\n' + '═'.repeat(60));
  console.log(`📊 SCORE: ${score}/100  ✅${passed}  ❌${failed}  ⚠️${warned}  total:${total}`);
  console.log(`   Asset 404s: ${asset404s.length} | API 404s: ${api404s.length}`);
  console.log(`   JS críticos: ${critErrs.length}`);
  console.log('═'.repeat(60));

  await wait(3000);
  await browser.close();
}

run().catch(async err => {
  console.error('Fatal:', err.message);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
