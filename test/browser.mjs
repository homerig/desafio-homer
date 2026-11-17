import { chromium, webkit, devices, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { createApp } from '../server/app.js';

const directory = mkdtempSync(join(tmpdir(), 'cumple-browser-'));
const db = openDatabase(directory), password = randomUUID();
db.prepare('INSERT INTO admins VALUES (?,?,?)').run('browser-admin', 'anfitrion', hashPassword(password));
const port = Number(process.env.TEST_PORT || 43071), base = `http://127.0.0.1:${port}`;
const runtime = createApp(db, { publicUrl: base, production: false });
const server = runtime.app.listen(port, '127.0.0.1');
let browser;
const errors = [], engine = process.env.BROWSER_ENGINE || 'chrome';
mkdirSync('test-results', { recursive: true });
try {
  await once(server, 'listening');
  browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const admin = await adminContext.newPage();
  admin.on('pageerror', error => errors.push(error.message));
  admin.on('dialog', dialog => dialog.accept());
  await admin.goto(base); await expect(admin.getByRole('heading', { name: /Hoy se festeja/ })).toBeVisible();
  await admin.screenshot({ path: `test-results/${engine}-landing-desktop.png`, fullPage: true });
  await admin.goto(`${base}/admin`);
  await admin.getByLabel('Usuario', { exact: true }).fill('anfitrion');
  await admin.getByLabel('Contraseña', { exact: true }).fill(password);
  await admin.getByRole('button', { name: 'Entrar al panel' }).click();
  await expect(admin.getByRole('heading', { name: 'Desafío Homer' })).toBeVisible();
  const code = new URL(admin.url()).pathname.split('/').at(-1);
  const participants = [];
  for (const [i, name] of ['AZUL_7', 'Azu23', 'Juano99', 'Marti', 'Sofi', 'Tomi'].entries()) {
    const context = await browser.newContext({ ...devices[i % 2 ? 'Pixel 7' : 'iPhone 13'] });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.goto(base);
    await expect(page.locator('input[name="code"]')).toHaveCount(0);
    await page.getByLabel('¿Cómo te llamás?').fill(name);
    await page.getByRole('button', { name: 'Entrar a la fiesta' }).click();
    await expect(page.getByRole('heading', { name: `¡Llegaste, ${name}!` })).toBeVisible();
    participants.push({ page, name });
  }
  await expect(admin.getByText('6 invitados', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Cerrar inscripciones', exact: true }).click();
  await admin.locator('#alias-azu').selectOption({ label: 'AZUL_7' });
  await admin.getByRole('button', { name: 'Sortear los equipos' }).click();
  await expect(participants[0].page.getByText('TE TOCÓ SER PARTE DE')).toBeVisible();
  await admin.screenshot({ path: `test-results/${engine}-admin-lobby.png`, fullPage: true });
  await participants[0].page.screenshot({ path: `test-results/${engine}-iphone-team.png`, fullPage: true });
  async function mobileCheck(page, screen) {
    const original = page.viewportSize();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen}: ${width}px`).toBe(true);
    }
    await page.setViewportSize(original);
  }
  await mobileCheck(participants[0].page, 'Equipo');
  const getState = page => page.evaluate(async code => (await fetch(`/api/rooms/${code}/state`)).json(), code);
  const getAdmin = () => admin.evaluate(async code => (await fetch(`/api/rooms/${code}/state?role=admin`)).json(), code);
  await admin.getByRole('button', { name: 'Encontrá tu animal', exact: true }).click();
  await admin.getByRole('button', { name: 'Iniciar los 2 minutos' }).click();
  await expect(participants[0].page.getByLabel('El código de tu compañero')).toBeVisible();
  for (const p of participants) p.state = await getState(p.page);
  const first = participants[0], same = participants.find(p => p !== first && p.state.me.team === first.state.me.team);
  const oldEnd = first.state.games[1].endsAt;
  await first.page.getByLabel('El código de tu compañero').fill(same.state.games[1].me.code);
  await participants[2].page.reload();
  await expect(first.page.getByLabel('El código de tu compañero')).toHaveValue(same.state.games[1].me.code);
  await first.page.getByRole('button', { name: 'Confirmar código' }).click();
  await same.page.getByLabel('El código de tu compañero').fill(first.state.games[1].me.code);
  await same.page.getByRole('button', { name: 'Confirmar código' }).click();
  await expect(first.page.getByText(/¡Intercambio confirmado!/)).toBeVisible();
  await first.page.reload();
  await expect(first.page.getByLabel('El código de tu compañero')).toBeVisible();
  const recovered = await getState(first.page);
  expect(recovered.me.id).toBe(first.state.me.id); expect(recovered.games[1].endsAt).toBe(oldEnd);
  expect(recovered.games[1].scores[first.state.me.team]).toBe(1);
  await mobileCheck(first.page, 'Animal');
  await first.page.screenshot({ path: `test-results/${engine}-iphone-animal.png`, fullPage: true });
  await admin.getByRole('button', { name: 'Cazá el color', exact: true }).click();
  await admin.getByRole('button', { name: 'Iniciar los 2 minutos' }).click();
  await expect(first.page.getByRole('button', { name: 'Abrir cámara' })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await first.page.getByRole('button', { name: /Saltar color/ }).click();
    await expect(first.page.getByRole('button', { name: /Saltar color/ })).toContainText(`${2 - i} disponibles`);
  }
  await expect(first.page.getByRole('button', { name: /Saltar color/ })).toBeDisabled();
  const colorState = await getState(first.page);
  const colorBytes = await sharp({ create: { width: 400, height: 500, channels: 3, background: colorState.games[2].me.challenge.hex } }).jpeg().toBuffer();
  await first.page.getByRole('button', { name: 'Abrir cámara' }).click();
  // Exercise capture preview/upload independently of physical camera hardware.
  await first.page.locator('#photo-file').setInputFiles({ name: 'color.jpg', mimeType: 'image/jpeg', buffer: colorBytes });
  await first.page.getByRole('button', { name: 'Enviar foto' }).click();
  await expect(first.page.getByText('¡Color encontrado! +1 punto para tu salita.', { exact: true })).toBeVisible();
  await first.page.reload(); await expect(first.page.getByRole('button', { name: /Saltar color/ })).toBeDisabled();
  await mobileCheck(first.page, 'Color');
  await first.page.screenshot({ path: `test-results/${engine}-iphone-color.png`, fullPage: true });
  await admin.getByRole('button', { name: 'Desafío de fotos', exact: true }).click();
  await admin.getByRole('button', { name: 'Sortear fotógrafos e iniciar juego' }).click();
  await admin.getByRole('button', { name: 'Cargar referencia' }).click();
  await admin.locator('#photo-file').setInputFiles({ name: 'pose.jpg', mimeType: 'image/jpeg', buffer: colorBytes });
  await admin.getByRole('button', { name: 'Guardar referencia' }).click();
  await expect(admin.getByAltText('Pose de referencia')).toBeVisible();
  await admin.getByRole('button', { name: 'Lanzar consigna 1' }).click();
  await mobileCheck(first.page, 'Fotos');
  const photoState = await getAdmin();
  for (const team of ['verde', 'roja']) {
    const p = participants.find(p => p.state.me.id === photoState.games[3].photographers[team]);
    await p.page.getByRole('button', { name: 'Preparar la foto del equipo' }).click();
    await p.page.locator('#photo-file').setInputFiles({ name: 'equipo.jpg', mimeType: 'image/jpeg', buffer: colorBytes });
    await p.page.getByRole('button', { name: 'Enviar foto' }).click();
    await expect(p.page.getByText(/¡Foto entregada! El anfitrión/)).toBeVisible();
  }
  await admin.getByRole('button', { name: 'Cerrar consigna y revisar' }).click();
  await admin.getByRole('button', { name: 'Revisar ↗', exact: true }).first().click();
  await expect(admin.getByText(/Tiempo hasta el envío:/)).toBeVisible();
  await expect(admin.getByText('1 de 2', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Siguiente →', exact: true }).click();
  await expect(admin.getByText('2 de 2', { exact: true })).toBeVisible();
  await admin.locator('#modal').getByRole('button', { name: 'Salita verde' }).click();
  await expect(admin.getByText('Guardado: 1 punto para Salita verde')).toBeVisible();
  await admin.locator('#modal').getByRole('button', { name: 'Salita roja' }).click();
  await expect(admin.getByText('Guardado: 1 punto para Salita roja')).toBeVisible();
  await admin.screenshot({ path: `test-results/${engine}-photo-review.png`, fullPage: true });
  await admin.getByRole('button', { name: 'Cerrar revisión' }).click();
  await admin.getByRole('button', { name: 'Resultados finales', exact: true }).click();
  await expect(first.page.getByRole('heading', { name: 'Cada punto cuenta' })).toBeVisible();
  await mobileCheck(first.page, 'Resultados');
  await first.page.screenshot({ path: `test-results/${engine}-iphone-results.png`, fullPage: true });
  await participants[1].page.screenshot({ path: `test-results/${engine}-android-results.png`, fullPage: true });
  for (const p of participants) {
    expect(await p.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await admin.getByRole('button', { name: 'Reiniciar toda la fiesta' }).click();
  await expect(admin.getByText('0 invitados', { exact: true })).toBeVisible();
  for (const p of participants) await expect(p.page.getByLabel('¿Cómo te llamás?')).toBeVisible();
  await first.page.getByLabel('¿Cómo te llamás?').fill('Volví a jugar');
  await first.page.getByRole('button', { name: 'Entrar a la fiesta' }).click();
  await expect(first.page.getByRole('heading', { name: '¡Llegaste, Volví a jugar!' })).toBeVisible();
  await expect(admin.getByText('1 invitados', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(`OK: ${engine}; administrador desktop + 6 celulares emulados (iPhone 13 y Pixel 7); 3 juegos, recarga, cámara por archivo, galería y corrección de puntos. Sin errores JavaScript ni desbordamiento horizontal.`);
} finally {
  if (browser) await browser.close();
  runtime.stop(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true });
}
