import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { decodePhoto, validateColor, rgbToLab } from '../server/images.js';

test('Lab convierte blanco y negro y acepta colores similares con cobertura suficiente', async () => {
  assert.ok(Math.abs(rgbToLab(255, 255, 255)[0] - 100) < .01);
  assert.equal(rgbToLab(0, 0, 0)[0], 0);
  for (const [background, expected] of [['#e34444', true], ['#d64b4a', true], ['#3869ce', false]]) {
    const image = await sharp({ create: { width: 400, height: 300, channels: 3, background } }).jpeg().toBuffer();
    const decoded = await decodePhoto(image);
    assert.equal(validateColor(decoded.pixels, '#e34444').accepted, expected);
    assert.equal((await decodePhoto(image)).hash, decoded.hash);
  }
});
test('unos pocos píxeles coincidentes o un borde rojo no alcanzan', async () => {
  const blue = Buffer.from([56, 105, 206]), red = Buffer.from([227, 68, 68]);
  const pixels = Buffer.alloc(160 * 160 * 3);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) (x < 24 || y < 24 || x >= 136 || y >= 136 ? red : blue).copy(pixels, (y * 160 + x) * 3);
  red.copy(pixels, (80 * 160 + 80) * 3);
  const result = validateColor(pixels, '#e34444'); assert.equal(result.accepted, false); assert.equal(result.coverage, 0);
});
test('rechaza archivos que no son fotos y dimensiones mínimas insuficientes', async () => {
  await assert.rejects(() => decodePhoto(Buffer.from('not a photo')));
  const tiny = await sharp({ create: { width: 12, height: 12, channels: 3, background: 'red' } }).png().toBuffer();
  await assert.rejects(() => decodePhoto(tiny));
});

test('el umbral efectivo es 3136 de 12544 muestras; redondear a 25% no aprueba', () => {
  const pixels = Buffer.alloc(160 * 160 * 3);
  let painted = 0;
  for (let y = 24; y < 136; y++) for (let x = 24; x < 136; x++) {
    if (painted++ < 3135) Buffer.from([227, 68, 68]).copy(pixels, (y * 160 + x) * 3);
  }
  assert.deepEqual(validateColor(pixels, '#e34444'), { accepted: false, coverage: 25 });
  const x = 24 + 3135 % 112, y = 24 + Math.floor(3135 / 112);
  Buffer.from([227, 68, 68]).copy(pixels, (y * 160 + x) * 3);
  assert.deepEqual(validateColor(pixels, '#e34444'), { accepted: true, coverage: 25 });
});
