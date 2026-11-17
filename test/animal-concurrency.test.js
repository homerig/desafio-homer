import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { digest, token } from '../server/auth.js';
import { newRoom, drawTeams, startGame } from '../server/game.js';

for (const count of [34, 35, 36]) test(`${count} conectados: dos duplas simultáneas y reintentos se confirman una sola vez`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'homer-parallel-')), db = openDatabase(dir);
  const room = newRoom('PRUEBA', 'Concurrencia');
  room.participants = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Jugador ${i}`, team: null }));
  room.registrationOpen = false; drawTeams(room);
  db.prepare('INSERT INTO rooms VALUES (?,?,?)').run(room.code, 'owner', JSON.stringify(room));
  const credentials = {};
  for (const p of room.participants) {
    const key = token(); credentials[p.id] = `cumple_guest=${key}`;
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(key), 'guest', p.id, Date.now() + 60000);
  }
  const runtime = createApp(db), server = runtime.app.listen(0, '127.0.0.1');
  const streams = [];
  try {
    await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of room.participants) {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/rooms/PRUEBA/events`, { headers: { Cookie: credentials[p.id] }, signal: controller.signal });
      const reader = response.body.getReader(); await reader.read(); streams.push({ controller, reader });
    }
    assert.equal(runtime.online(room.code).size, count);
    startGame(room, 1, runtime.online(room.code));
    const game = room.games[1], animal = game.players.p0.animal;
    const [a, b, c, d] = room.participants.filter(p => game.players[p.id].animal === animal);
    assert.ok(d);
    const outsiders = room.participants.filter(p => ![a, b, c, d].includes(p));
    const x = outsiders[0], y = outsiders.find(p => p !== x && game.players[p.id].animal === game.players[x.id].animal);
    game.pending[x.id] = { to: y.id, ownCode: game.players[x.id].code, targetCode: game.players[y.id].code };
    db.prepare('UPDATE rooms SET state=? WHERE code=?').run(JSON.stringify(room), room.code);
    const before = structuredClone(game);
    const send = async (first, second) => {
      const response = await fetch(`${base}/api/rooms/PRUEBA/exchange`, { method: 'POST', headers: { Cookie: credentials[first.id], 'X-Cumple-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ownCode: before.players[first.id].code, targetCode: before.players[second.id].code }) });
      return { status: response.status, body: await response.json() };
    };
    await Promise.all([send(a, b), send(c, d)]);
    const replies = await Promise.all([send(b, a), send(d, c), send(b, a), send(d, c)]);
    assert.equal(replies.filter(r => r.body.confirmed).length, 2);
    assert.equal(replies.filter(r => r.status === 409).length, 2);
    const saved = JSON.parse(db.prepare('SELECT state FROM rooms WHERE code=?').get(room.code).state).games[1];
    assert.equal(saved.exchanges.length, 2);
    for (const p of outsiders) assert.deepEqual(saved.players[p.id], before.players[p.id]);
    assert.deepEqual(saved.pending[x.id], before.pending[x.id]);
    for (const p of [a, b, c, d]) {
      assert.notEqual(saved.players[p.id].animal, before.players[p.id].animal);
      assert.ok(!Object.values(saved.players).some(q => q.code === before.players[p.id].code));
    }
    const expected = { verde: 0, roja: 0, azul: 0 };
    for (const [first, second] of [[a, b], [c, d]]) for (const team of new Set([first.team, second.team])) expected[team] += first.team === second.team ? 1 : 2;
    assert.deepEqual(saved.scores, expected);
    const counts = {};
    for (const p of Object.values(saved.players)) counts[p.animal] = (counts[p.animal] || 0) + 1;
    assert.ok(Object.values(counts).every(n => n >= 2));
    assert.equal(new Set(Object.values(saved.players).map(p => p.code)).size, count);
  } finally {
    for (const { controller, reader } of streams) { controller.abort(); await reader.cancel().catch(() => {}); }
    runtime.stop(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
