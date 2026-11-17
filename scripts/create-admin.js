import { loadEnvFile } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
try {
  const username = (process.env.ADMIN_USERNAME || await rl.question('Usuario administrativo: ')).trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    process.stdout.write('Contraseña (mínimo 12 caracteres, no se muestra): '); muted = true;
    password = await rl.question(''); muted = false; process.stdout.write('\n');
  }
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('El usuario debe tener de 3 a 40 letras, números, puntos o guiones.');
  if (password.length < 12 || password.length > 256) throw new Error('La contraseña debe tener de 12 a 256 caracteres.');
  const db = openDatabase();
  try {
    if (db.prepare('SELECT id FROM admins WHERE username=?').get(username)) throw new Error('Ese usuario ya existe. Elegí otro nombre.');
    db.prepare('INSERT INTO admins VALUES (?,?,?)').run(randomUUID(), username, hashPassword(password));
    console.log(`Cuenta «${username}» creada. Iniciá sesión en /admin.`);
  } finally { db.close(); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
