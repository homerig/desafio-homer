import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { verifyPassword } from '../server/auth.js';

test('la primera cuenta se crea con credenciales externas, hash y sin sobrescribir usuarios', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cumple-admin-')), password = randomUUID();
  const env = { ...process.env, DATA_DIR: directory, ADMIN_USERNAME: 'anfitrion', ADMIN_PASSWORD: password };
  try {
    const first = spawnSync(process.execPath, ['scripts/create-admin.js'], { env, encoding: 'utf8' });
    assert.equal(first.status, 0); assert.match(first.stdout, /creada/); assert.ok(!first.stdout.includes(password));
    const db = openDatabase(directory);
    const account = db.prepare('SELECT * FROM admins WHERE username=?').get('anfitrion');
    assert.notEqual(account.password, password); assert.equal(verifyPassword(password, account.password), true); db.close();
    const again = spawnSync(process.execPath, ['scripts/create-admin.js'], { env, encoding: 'utf8' });
    assert.equal(again.status, 1); assert.match(again.stderr, /ya existe/);
    const weak = spawnSync(process.execPath, ['scripts/create-admin.js'], { env: { ...env, ADMIN_USERNAME: 'otro', ADMIN_PASSWORD: 'abc' }, encoding: 'utf8' });
    assert.equal(weak.status, 1); assert.match(weak.stderr, /12 a 256/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
