import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { createApp } from '../server/app.js';

test('partida completa con 9 sesiones simultáneas, persistencia y permisos HTTP', { timeout: 30000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cumple-test-'));
  const db = openDatabase(dir), username = 'test-admin', password = randomUUID();
  db.prepare('INSERT INTO admins VALUES (?,?,?)').run('admin-test', username, hashPassword(password));
  let runtime, server, base;
  async function boot(port = 0) {
    runtime = createApp(db, { publicUrl: 'http://localhost:3000', production: false });
    server = runtime.app.listen(port, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  }
  await boot();
  const streams = [];
  const client = () => ({ cookie: '', id: null });
  const admin = client(), guests = Array.from({ length: 9 }, client);
  async function request(who, url, body, extra = {}) {
    const headers = { 'X-Cumple-Request': '1', Cookie: who.cookie, ...extra };
    const options = { headers };
    if (body !== undefined) {
      options.method = 'POST';
      headers['Content-Type'] ||= Buffer.isBuffer(body) ? 'image/jpeg' : 'application/json';
      options.body = Buffer.isBuffer(body) ? body : JSON.stringify(body);
    }
    const response = await fetch(base + url, options);
    const cookie = response.headers.get('set-cookie'); if (cookie) who.cookie = cookie.split(';')[0];
    const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, data };
  }
  let code;
  const state = async (who = admin) => (await request(who, `/api/rooms/${code}/state${who === admin ? '?role=admin' : ''}`)).data;
  const act = async (action, extra = {}) => request(admin, `/api/rooms/${code}/admin/action`, { action, ...extra });
  try {
    await t.test('login, QR, entrada y conexiones simultáneas', async () => {
      assert.equal((await request(admin, '/api/admin/login', { username, password })).status, 200);
      const created = await request(admin, '/api/admin/rooms', { title: 'Fiesta de prueba' }); assert.equal(created.status, 201); code = created.data.code;
      assert.equal((await request(admin, `/api/rooms/${code}/qr`)).status, 200);
      const joined = await Promise.all(guests.map((guest, i) => request(guest, `/api/rooms/${code}/join`, { name: ['AZUL_7', 'Juano99'][i] || `Invitado ${i}` })));
      joined.forEach((r, i) => { assert.equal(r.status, 200); guests[i].id = r.data.id; });
      for (const guest of guests) {
        const controller = new AbortController();
        const response = await fetch(`${base}/api/rooms/${code}/events`, { headers: { Cookie: guest.cookie }, signal: controller.signal });
        assert.equal(response.status, 200); const reader = response.body.getReader(); await reader.read();
        streams.push({ controller, reader });
      }
      const s = await state(); assert.equal(s.participants.length, 9); assert.ok(s.participants.every(p => p.online));
      const same = await request(guests[0], `/api/rooms/${code}/join`, { name: 'Otro nombre' });
      assert.equal(same.data.id, guests[0].id); assert.equal((await state()).participants.length, 9);
    });
    await t.test('permisos y origen se validan en el servidor', async () => {
      assert.equal((await request(guests[0], `/api/rooms/${code}/admin/action`, { action: 'draw' })).status, 401);
      assert.equal((await request(guests[0], '/api/admin/rooms')).status, 401);
      assert.equal((await request(admin, `/api/rooms/${code}/admin/action`, { action: 'registration', open: false }, { Origin: 'https://malicioso.example' })).status, 403);
      assert.equal((await request(client(), `/api/rooms/${code}/state`)).status, 401);
    });
    await t.test('sorteo equilibrado con aliases y cierre de inscripciones', async () => {
      assert.equal((await act('registration', { open: false })).status, 200);
      assert.equal((await act('draw')).status, 200);
      const s = await state(), a = s.participants.find(p => p.id === guests[0].id), b = s.participants.find(p => p.id === guests[1].id);
      assert.notEqual(a.team, b.team);
      for (const team of s.teams) assert.equal(s.participants.filter(p => p.team === team.id).length, 3);
      assert.equal((await request(client(), `/api/rooms/${code}/join`, { name: 'Tarde' })).status, 409);
    });
    await t.test('intercambios concurrentes puntúan una sola vez y la recarga conserva el reloj', async () => {
      assert.equal((await act('start', { game: 1 })).status, 200);
      const s = await state(), first = s.participants[0], mate = s.participants.find(p => p.id !== first.id && p.team === first.team);
      const a = guests.find(g => g.id === first.id), b = guests.find(g => g.id === mate.id);
      const sa = await state(a), sb = await state(b), ca = sa.games[1].me.code, cb = sb.games[1].me.code;
      assert.equal(sa.games[1].endsAt - sa.games[1].startedAt, 120000);
      assert.equal((await state(a)).me.id, a.id); assert.equal((await state(a)).games[1].endsAt, sa.games[1].endsAt);
      const results = await Promise.all([
        request(a, `/api/rooms/${code}/exchange`, { ownCode: ca, targetCode: cb }),
        request(a, `/api/rooms/${code}/exchange`, { ownCode: ca, targetCode: cb }),
        request(b, `/api/rooms/${code}/exchange`, { ownCode: cb, targetCode: ca }),
        request(b, `/api/rooms/${code}/exchange`, { ownCode: cb, targetCode: ca }),
      ]);
      assert.equal(results.filter(r => r.data.confirmed).length, 1);
      assert.equal((await state()).games[1].scores[first.team], 1);
      assert.equal((await request(a, `/api/rooms/${code}/exchange`, { ownCode: ca, targetCode: cb })).status, 409);
      const all = await Promise.all(guests.map(state));
      const otherA = all.find(x => x.me.id !== a.id && x.me.id !== b.id);
      const otherB = all.find(x => x.me.team !== otherA.me.team && x.games[1].me.animal === otherA.games[1].me.animal);
      const ga = guests.find(g => g.id === otherA.me.id), gb = guests.find(g => g.id === otherB.me.id);
      const before = (await state()).games[1].scores;
      await request(ga, `/api/rooms/${code}/exchange`, { ownCode: otherA.games[1].me.code, targetCode: otherB.games[1].me.code });
      await request(gb, `/api/rooms/${code}/exchange`, { ownCode: otherB.games[1].me.code, targetCode: otherA.games[1].me.code });
      const after = (await state()).games[1].scores;
      assert.equal(after[otherA.me.team] - before[otherA.me.team], 2); assert.equal(after[otherB.me.team] - before[otherB.me.team], 2);
      assert.equal((await act('navigate', { game: 2 })).status, 409);
      const saved = JSON.parse(db.prepare('SELECT state FROM rooms WHERE code=?').get(code).state);
      saved.games[1].endsAt = Date.now() - 1;
      db.prepare('UPDATE rooms SET state=? WHERE code=?').run(JSON.stringify(saved), code);
      assert.equal((await state()).games[1].status, 'finished');
    });
    await t.test('color real: rechazo, aprobación concurrente, captura duplicada y cuarto salto', async () => {
      assert.equal((await act('start', { game: 2 })).status, 200);
      const guest = guests[0];
      for (let i = 0; i < 3; i++) { const s = await state(guest); assert.equal((await request(guest, `/api/rooms/${code}/skip`, { challengeId: s.games[2].me.challenge.id })).status, 200); }
      let s = await state(guest); const challenge = s.games[2].me.challenge;
      assert.equal(s.games[2].me.skips, 3);
      assert.equal((await request(guest, `/api/rooms/${code}/skip`, { challengeId: challenge.id })).status, 400);
      const wrong = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000000' } }).jpeg().toBuffer();
      const rejected = await request(guest, `/api/rooms/${code}/color-photo`, wrong, { 'X-Challenge-Id': challenge.id }); assert.equal(rejected.status, 200); assert.equal(rejected.data.accepted, false);
      assert.equal((await state(guest)).games[2].me.challenge.id, challenge.id);
      const correct = await sharp({ create: { width: 300, height: 300, channels: 3, background: challenge.hex } }).jpeg().toBuffer();
      const approvals = await Promise.all([1, 2].map(() => request(guest, `/api/rooms/${code}/color-photo`, correct, { 'X-Challenge-Id': challenge.id })));
      assert.deepEqual(approvals.map(r => r.status).sort(), [200, 409]);
      s = await state(guest); assert.equal(s.games[2].scores[s.me.team], 1);
      assert.equal((await request(guest, `/api/rooms/${code}/color-photo`, correct, { 'X-Challenge-Id': s.games[2].me.challenge.id })).status, 409);
      assert.equal((await request(guest, `/api/rooms/${code}/color-photo`, Buffer.alloc(1000), { 'X-Challenge-Id': s.games[2].me.challenge.id })).status, 400);
      assert.equal((await act('navigate', { game: 3, confirmed: true })).status, 200);
    });
    await t.test('fotógrafos, entrega única, acceso privado y corrección de ganador', async () => {
      assert.equal((await act('start', { game: 3 })).status, 200);
      let s = await state(), g = s.games[3];
      assert.equal((await act('prompt', { index: 0, runId: g.runId })).status, 200);
      const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#d8cefa' } }).jpeg().toBuffer();
      const headers = { 'X-Prompt-Index': '0', 'X-Run-Id': g.runId };
      const wrong = guests.find(p => !Object.values(g.photographers).includes(p.id));
      assert.equal((await request(wrong, `/api/rooms/${code}/team-photo`, photo, headers)).status, 403);
      const photographer = guests.find(p => p.id === g.photographers.verde);
      const deliveries = await Promise.all([1, 2].map(() => request(photographer, `/api/rooms/${code}/team-photo`, photo, headers)));
      assert.deepEqual(deliveries.map(r => r.status).sort(), [200, 409]);
      await request(guests.find(p => p.id === g.photographers.roja), `/api/rooms/${code}/team-photo`, photo, headers);
      s = await state(); const submission = s.games[3].prompts[0].submissions.verde;
      assert.ok(submission.elapsedMs >= 0 && submission.elapsedMs < 10000);
      assert.equal((await request(admin, `${submission.url}?role=admin`)).status, 200);
      assert.equal((await request(photographer, submission.url)).status, 403);
      assert.deepEqual((await state(photographer)).games[3].prompts[0].submissions.verde, { received: true });
      await act('close', { game: 3, runId: g.runId, index: 0 });
      assert.equal((await request(photographer, `/api/rooms/${code}/team-photo`, photo, headers)).status, 409);
      for (const winner of ['verde', 'verde', 'roja']) assert.equal((await act('award', { index: 0, winner, runId: g.runId })).status, 200);
      s = await state(); assert.equal(s.games[3].scores.verde, 0); assert.equal(s.games[3].scores.roja, 1);
      assert.equal((await act('award', { index: 0, winner: 'azul', runId: g.runId })).status, 400);
      await act('prompt', { index: 1, runId: g.runId }); await act('close', { game: 3, runId: g.runId, index: 1 });
      assert.equal((await act('prompt', { index: 2, runId: g.runId })).status, 400);
      assert.equal((await request(admin, `/api/rooms/${code}/admin/reference`, photo, { 'X-Run-Id': g.runId })).status, 200);
      s = await state(); assert.equal((await request(guests[0], s.games[3].reference)).status, 403);
      await act('prompt', { index: 2, runId: g.runId });
      assert.equal((await request(guests[0], s.games[3].reference)).status, 200);
      await act('close', { game: 3, runId: g.runId, index: 2 });
      const replacement = s.participants.find(p => p.team === 'verde' && p.id !== g.photographers.verde);
      await act('photographer', { team: 'verde', playerId: replacement.id });
      assert.equal((await state()).games[3].photographers.verde, replacement.id);
    });
    await t.test('volver conserva resultados; reiniciar borra solamente el juego elegido', async () => {
      const before = await state();
      await act('navigate', { game: 1 }); await act('navigate', { game: 3 });
      assert.deepEqual((await state()).totals, before.totals);
      assert.equal((await act('reset', { game: 3, runId: before.games[3].runId, confirmed: true })).status, 200);
      const after = await state();
      assert.deepEqual(after.games[1].scores, before.games[1].scores); assert.deepEqual(after.games[2].scores, before.games[2].scores);
      assert.deepEqual(after.games[3].scores, { verde: 0, roja: 0, azul: 0 });
      assert.equal(after.games[3].reference, null); assert.equal(db.prepare('SELECT count(*) AS n FROM assets').get().n, 0);
      assert.deepEqual(after.participants.map(p => p.team), before.participants.map(p => p.team));
      assert.equal((await act('reset', { game: 3, runId: before.games[3].runId, confirmed: true })).status, 409);
    });
    await t.test('un reinicio de servidor conserva la identidad, equipos y resultados', async () => {
      const before = await state(guests[0]);
      for (const stream of streams) { stream.controller.abort(); await stream.reader.cancel().catch(() => {}); }
      runtime.stop(); await new Promise(resolve => server.close(resolve));
      await boot();
      const after = await state(guests[0]);
      assert.equal(after.me.id, before.me.id); assert.equal(after.me.team, before.me.team);
      assert.deepEqual(after.totals, before.totals); assert.equal(after.games[2].me.skips, 3);
      assert.ok(after.participants.every(p => !p.online));
    });
    await t.test('reinicio general protegido, completo e idempotente permite volver a inscribirse', async () => {
      const before = await state(), runId = before.games[1].runId;
      const photo = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
      await request(admin, `/api/rooms/${code}/admin/reference`, photo, { 'X-Run-Id': before.games[3].runId });
      assert.ok(db.prepare('SELECT count(*) AS n FROM assets').get().n > 0);
      assert.equal((await request(guests[0], `/api/rooms/${code}/admin/action`, { action: 'reset-party', confirmed: true, runId })).status, 401);
      assert.equal((await act('reset-party', { runId })).status, 400);
      assert.equal((await state()).participants.length, 9);
      assert.equal((await act('reset-party', { confirmed: true, runId })).status, 200);
      const after = await state();
      assert.equal(after.participants.length, 0); assert.equal(after.drawn, false);
      assert.equal(after.registrationOpen, true); assert.equal(after.selectedGame, 0);
      assert.ok(after.version > before.version);
      for (const game of Object.values(after.games)) {
        assert.equal(game.status, 'idle'); assert.deepEqual(game.scores, { verde: 0, roja: 0, azul: 0 });
      }
      assert.equal(db.prepare('SELECT count(*) AS n FROM assets').get().n, 0);
      assert.equal((await request(guests[0], `/api/rooms/${code}/state`)).status, 401);
      assert.equal((await request(guests[0], `/api/rooms/${code}/join`, { name: 'De nuevo' })).status, 200);
      assert.equal((await act('reset-party', { confirmed: true, runId })).status, 409);
      assert.equal((await state()).participants.length, 1);
      assert.equal((await state(guests[0])).me.name, 'De nuevo');
    });
  } finally {
    for (const stream of streams) { stream.controller.abort(); await stream.reader.cancel().catch(() => {}); }
    runtime.stop(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
