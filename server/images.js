import sharp from 'sharp';
import { createHash } from 'node:crypto';

export function rgbToLab(r, g, b) {
  const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  [r, g, b] = [r, g, b].map(linear);
  const f = v => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((r * .4124564 + g * .3575761 + b * .1804375) / .95047);
  const y = f(r * .2126729 + g * .7151522 + b * .072175);
  const z = f((r * .0193339 + g * .119192 + b * .9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export async function decodePhoto(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > 8 * 1024 * 1024) throw new Error('La foto debe pesar menos de 8 MB.');
  const source = sharp(bytes, { limitInputPixels: 25000000, failOn: 'error' }).rotate();
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.width < 64 || metadata.height < 64) throw new Error('Usá una foto JPG, PNG o WebP de al menos 64 × 64 píxeles.');
  const normalized = await source.resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).toColourspace('srgb').jpeg({ quality: 82 }).toBuffer();
  const pixels = await sharp(normalized).resize(160, 160, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const hash = createHash('sha256').update(pixels).digest('hex');
  return { bytes: normalized, pixels, hash };
}

export function validateColor(pixels, hex, deltaE = 32, minimumCoverage = .25) {
  const target = rgbToLab(...hex.match(/[\da-f]{2}/gi).map(v => parseInt(v, 16)));
  let matched = 0, total = 0;
  // Analyze only the central 70% shown by the camera guide. Tiny matching spots cannot pass.
  for (let y = 24; y < 136; y++) for (let x = 24; x < 136; x++) {
    const i = (y * 160 + x) * 3;
    const lab = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (Math.hypot(...lab.map((v, j) => v - target[j])) <= deltaE) matched++;
    total++;
  }
  const coverage = matched / total;
  return { accepted: coverage >= minimumCoverage, coverage: Math.round(coverage * 100) };
}
