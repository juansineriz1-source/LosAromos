/**
 * test-desktop.mjs — Screenshot de RodeoApp en pantalla grande
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://los-aromos.vercel.app';
const SS_DIR = join(__dirname, 'qa-screenshots');
mkdirSync(SS_DIR, { recursive: true });

const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  args: ['--window-size=1400,900', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});

const page = await browser.newPage();

await page.evaluateOnNewDocument(() => {
  localStorage.setItem('rodeo_operador', 'Juan');
  localStorage.setItem('rodeo_rol', 'admin');
  localStorage.setItem('rodeo_app_version', '53');
});

await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
await wait(2500);

// Screenshot de cada tab en desktop
const tabs = ['inicio', 'baston', 'rodeo', 'recorrida', 'agenda'];

for (const tab of tabs) {
  await page.evaluate(id => {
    document.getElementById(`nav-${id}`)?.click();
  }, tab);
  await wait(1000);
  await page.screenshot({ path: join(SS_DIR, `desktop-${tab}.png`), fullPage: false });
  console.log(`✅ Screenshot: desktop-${tab}`);
}

await wait(1000);
await browser.close();
console.log('\nDone. Screenshots en qa-screenshots/desktop-*.png');
