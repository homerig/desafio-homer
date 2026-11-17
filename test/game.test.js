import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, aliasGroup, drawTeams, startGame, exchange, canExchange, rotationOptions, skipColor, approveColor, startPrompt, submitTeamPhoto, award, navigate, emptyGame, expireRounds, view } from '../server/game.js';

function fixture(count = 9) {
  const room = newRoom('FIESTA', 'Prueba');
  room.participants = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: ['AZUL_7', 'Juano99'][i] || `Invitado ${i}`, team: null }));
  room.registrationOpen = false; drawTeams(room);
  return { room, ids: new Set(room.participants.map(p => p.id)) };
}
test('los alias se comparan completos, sin números, separadores ni mayúsculas', () => {
  for (const name of ['Azu', 'Azul', 'Azu23', 'AZUL_7', 'a.z.u-l 8']) assert.equal(aliasGroup(name), 'azu');
  for (const name of ['Juani', 'Juano', 'Juani-10', 'Juano99']) assert.equal(aliasGroup(name), 'juani');
  for (const name of ['Azulina', 'Juanito', 'Juan', 'Lazu', 'JuanoPedro']) assert.equal(aliasGroup(name), null);
});
test('sorteos equilibrados separan los alias, incluso con cantidades impares', () => {
  for (let n = 3; n <= 50; n++) for (let repetition = 0; repetition < 10; repetition++) {
    const { room } = fixture(n), counts = ['verde', 'roja', 'azul'].map(t => room.participants.filter(p => p.team === t).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    assert.notEqual(room.participants[0].team, room.participants[1].team);
  }
});
test('un solo alias no bloquea el sorteo y las inscripciones ambiguas requieren elección', () => {
  const room = newRoom('FIESTA', 'Prueba'); room.registrationOpen = false;
  room.participants = [{ id: 'a', name: 'Azu' }, { id: 'b', name: 'Azu23' }, { id: 'c', name: 'Juanito' }, { id: 'd', name: 'Juani' }];
  assert.throws(() => drawTeams(room), /Confirmá/);
  drawTeams(room, { azu: 'b' });
  assert.notEqual(room.participants[1].team, room.participants[3].team);
  const single = newRoom('OTRA', 'Prueba'); single.registrationOpen = false;
  single.participants = [{ id: 'a', name: 'AZUL_7' }, { id: 'b', name: 'Juanito' }, { id: 'c', name: 'Pepe' }];
  drawTeams(single); assert.equal(new Set(single.participants.map(p => p.team)).size, 3);
});
function match(room, ids, a, b) {
  const own = room.games[1].players[a.id].code, other = room.games[1].players[b.id].code;
  assert.equal(exchange(room, a, own, other, ids).confirmed, false);
  assert.equal(exchange(room, b, other, own, ids).confirmed, true);
  return { own, other };
}
test('mismo equipo suma 1 total, equipos distintos suman 2 cada uno; no se reutilizan códigos', () => {
  for (const same of [true, false]) {
    const { room, ids } = fixture(); startGame(room, 1, ids);
    const a = room.participants[0], b = room.participants.find(p => p.id !== a.id && (same ? p.team === a.team : p.team !== a.team));
    const oldAnimal = room.games[1].players[a.id].animal;
    const { own, other } = match(room, ids, a, b);
    assert.equal(room.games[1].scores[a.team], same ? 1 : 2);
    assert.equal(Object.values(room.games[1].scores).reduce((a, b) => a + b), same ? 1 : 4);
    assert.equal(room.games[1].counts[a.team], 1);
    assert.notEqual(room.games[1].players[a.id].animal, oldAnimal);
    assert.notEqual(room.games[1].players[b.id].animal, oldAnimal);
    assert.throws(() => exchange(room, b, other, own, ids), /cambió/);
    assert.throws(() => exchange(room, a, room.games[1].players[a.id].code, other, ids), /no corresponde/);
    assert.equal(room.games[1].exchanges.length, 1);
    assert.equal(Object.keys(room.games[1].pending).length, 0);
  }
});
test('3 no puede iniciar; 4 es el mínimo admitido', () => {
  const { room, ids } = fixture(3);
  const before = structuredClone(room);
  assert.throws(() => startGame(room, 1, ids), /al menos 4/);
  assert.deepEqual(room, before);
  const four = fixture(4); startGame(four.room, 1, four.ids);
  assert.equal(four.room.games[1].status, 'active');
});
test('4, 5, 34, 35 y 36: 300 intercambios consecutivos, solo cambia la dupla y no hay bloqueo global', () => {
  for (const n of [4, 5, 34, 35, 36]) {
    const { room, ids } = fixture(n); startGame(room, 1, ids);
    const game = room.games[1];
    for (let turn = 0; turn < 300; turn++) {
      const candidates = room.participants.flatMap(a => room.participants.filter(b => a.id < b.id && canExchange(game, a.id, b.id, ids)).map(b => [a, b]));
      assert.ok(candidates.length, `Sin duplas para ${n}, turno ${turn}`);
      const [a, b] = candidates[turn % candidates.length];
      // An unrelated pending attempt survives; an attempt at a rotated code does not.
      const outsiders = room.participants.filter(p => p !== a && p !== b);
      game.pending[outsiders[0].id] = { to: outsiders[1].id, ownCode: game.players[outsiders[0].id].code, targetCode: game.players[outsiders[1].id].code };
      if (outsiders[2]) game.pending[outsiders[2].id] = { to: a.id, ownCode: game.players[outsiders[2].id].code, targetCode: game.players[a.id].code };
      const before = structuredClone(game), destinations = rotationOptions(game, a.id, b.id, ids);
      const { own, other } = match(room, ids, a, b);
      assert.ok(destinations.includes(game.players[a.id].animal));
      for (const p of outsiders) assert.deepEqual(game.players[p.id], before.players[p.id]);
      assert.deepEqual(game.pending[outsiders[0].id], before.pending[outsiders[0].id]);
      if (outsiders[2]) assert.equal(game.pending[outsiders[2].id], undefined);
      assert.notEqual(game.players[a.id].animal, before.players[a.id].animal);
      assert.notEqual(game.players[b.id].animal, before.players[b.id].animal);
      const counts = {};
      for (const p of Object.values(game.players)) counts[p.animal] = (counts[p.animal] || 0) + 1;
      assert.ok(Object.values(counts).every(count => count >= 2));
      const codes = Object.values(game.players).map(p => p.code);
      assert.equal(new Set(codes).size, n); assert.ok(codes.every(c => /^\d{4}$/.test(c)));
      assert.ok(!codes.includes(own) && !codes.includes(other));
      assert.throws(() => exchange(room, a, own, other, ids), /cambió/);
      const points = a.team === b.team ? 1 : 2;
      for (const team of ['verde', 'roja', 'azul']) assert.equal(game.scores[team] - before.scores[team], [a.team, b.team].includes(team) ? points : 0);
    }
  }
});
test('un grupo de tres espera, recibe prioridad como destino y vuelve a poder intercambiar', () => {
  const { room, ids } = fixture(5); startGame(room, 1, ids);
  const [a, b, c, d] = room.participants; match(room, ids, a, b);
  const before = structuredClone(room);
  assert.throws(() => exchange(room, c, room.games[1].players[c.id].code, room.games[1].players[d.id].code, ids), /tres/);
  assert.deepEqual(room, before);
  // The pair has nobody else available, so repeating is necessary and permitted.
  match(room, ids, a, b);
  assert.equal(new Set(Object.values(room.games[1].players).map(p => p.animal)).size, 1);
  const stable = structuredClone(room);
  assert.throws(() => exchange(room, a, room.games[1].players[a.id].code, room.games[1].players[b.id].code, ids), /otros compañeros/);
  assert.deepEqual(room, stable);
  match(room, ids, a, c);
});
test('ceros iniciales válidos y formato de 6 dígitos rechazado', () => {
  const { room, ids } = fixture(4); startGame(room, 1, ids);
  const [a, b] = room.participants;
  room.games[1].players[a.id].code = '0000'; room.games[1].players[b.id].code = '0007';
  room.games[1].usedCodes.push('0000', '0007');
  assert.throws(() => exchange(room, a, '0000', '000007', ids), /4 dígitos/);
  match(room, ids, a, b);
  assert.ok(!Object.values(room.games[1].players).some(p => ['0000', '0007'].includes(p.code)));
});
test('una desconexión no permite aislar al tercero ni modifica su estado', () => {
  const { room, ids } = fixture(4); startGame(room, 1, ids);
  const [a, b, c, d] = room.participants; ids.delete(d.id);
  const before = structuredClone(room);
  assert.throws(() => exchange(room, a, room.games[1].players[a.id].code, room.games[1].players[b.id].code, ids), /tres/);
  assert.deepEqual(room, before);
  ids.add(d.id); match(room, ids, a, b);
  assert.deepEqual(room.games[1].players[c.id], before.games[1].players[c.id]);
});
test('falta de compañeros y códigos de animales distintos no generan intercambios', () => {
  const { room, ids } = fixture(6);
  assert.throws(() => startGame(room, 1, new Set(['p0'])), /al menos 4/);
  startGame(room, 1, ids); match(room, ids, room.participants[0], room.participants[1]);
  const players = room.games[1].players;
  assert.throws(() => exchange(room, room.participants[0], players.p0.code, players.p2.code, ids), /no corresponde/);
  assert.throws(() => exchange(room, room.participants[0], players.p0.code, players.p0.code, ids), /no corresponde/);
});
test('el reloj vence en el servidor, cierra pendientes y no cambia al volver a un juego', () => {
  const { room, ids } = fixture(); const now = Date.now(); startGame(room, 1, ids, now);
  exchange(room, room.participants[0], room.games[1].players.p0.code, room.games[1].players.p1.code, ids);
  assert.equal(expireRounds(room, now + 119999), false);
  assert.equal(expireRounds(room, now + 120000), true);
  assert.equal(room.games[1].status, 'finished'); assert.deepEqual(room.games[1].pending, {});
  navigate(room, 2); navigate(room, 1); assert.equal(room.games[1].endsAt, now + 120000);
});
test('tres saltos persistidos; cuarto bloqueado; desafíos y capturas no puntúan dos veces', () => {
  const { room, ids } = fixture(); startGame(room, 2, ids);
  const player = room.participants[0];
  for (let i = 0; i < 3; i++) {
    const old = room.games[2].players[player.id].challenge.id;
    skipColor(room, player.id, old);
    assert.throws(() => skipColor(room, player.id, old), /cambió/);
  }
  const state = room.games[2].players[player.id];
  assert.equal(state.skips, 3); assert.throws(() => skipColor(room, player.id, state.challenge.id), /3 saltos/);
  const challenge = state.challenge.id;
  approveColor(room, player, challenge, 'foto-a', { accepted: false });
  assert.equal(state.challenge.id, challenge); assert.equal(room.games[2].scores[player.team], 0);
  approveColor(room, player, challenge, 'foto-a', { accepted: true });
  assert.equal(room.games[2].scores[player.team], 1);
  assert.throws(() => approveColor(room, player, challenge, 'foto-a', { accepted: true }), /resolvió/);
  assert.throws(() => approveColor(room, player, state.challenge.id, 'foto-a', { accepted: true }), /captura/);
});
test('consignas simultáneas, fotógrafo, tiempo, adjudicaciones corregibles y reinicio aislado', () => {
  const { room, ids } = fixture(); startGame(room, 3, ids, 1000); startPrompt(room, 0, 2000);
  const game = room.games[3], green = room.participants.find(p => p.id === game.photographers.verde), red = room.participants.find(p => p.id === game.photographers.roja);
  const wrong = room.participants.find(p => p.team === 'verde' && p.id !== green.id);
  assert.throws(() => submitTeamPhoto(room, wrong, 0, 'photo', game.runId, 5000), /Solo puede/);
  submitTeamPhoto(room, green, 0, 'green-photo', game.runId, 5500);
  submitTeamPhoto(room, red, 0, 'red-photo', game.runId, 6000);
  assert.equal(game.prompts[0].submissions.verde.elapsedMs, 3500);
  assert.throws(() => submitTeamPhoto(room, green, 0, 'again', game.runId, 7000), /entrega final/);
  assert.throws(() => award(room, 0, 'verde'), /Cerrá/);
  assert.throws(() => navigate(room, 1), /Confirmá/);
  navigate(room, 1, true); award(room, 0, 'verde'); award(room, 0, 'verde');
  assert.equal(game.scores.verde, 1);
  award(room, 0, 'roja'); assert.equal(game.scores.verde, 0); assert.equal(game.scores.roja, 1);
  award(room, 0, null); assert.equal(game.scores.roja, 0);
  award(room, 0, 'verde'); navigate(room, 3); assert.equal(game.scores.verde, 1);
  startPrompt(room, 1); navigate(room, 0, true);
  assert.throws(() => startPrompt(room, 2), /referencia/);
  game.reference = 'ref'; startPrompt(room, 2);
  room.games[2].scores.azul = 7;
  room.games[3] = emptyGame(3);
  assert.equal(room.games[2].scores.azul, 7); assert.equal(room.participants[0].team !== null, true);
});
test('la vista de invitado solo incluye su código y nunca expone fotos ni hashes', () => {
  const { room, ids } = fixture(); startGame(room, 1, ids);
  const guest = JSON.stringify(view(room, 'guest', 'p0', ids, 'https://fiesta.test'));
  assert.ok(guest.includes(room.games[1].players.p0.code));
  for (const [id, p] of Object.entries(room.games[1].players)) if (id !== 'p0') assert.ok(!guest.includes(`"code":"${p.code}"`));
  assert.ok(!guest.includes('usedCodes')); assert.ok(!guest.includes('captures'));
  const admin = view(room, 'admin', null, ids, 'https://fiesta.test'); assert.equal(admin.games[1].me, undefined);
});
