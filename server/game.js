import { randomInt, randomUUID } from 'node:crypto';

export const TEAMS = [
  { id: 'verde', name: 'Salita verde', color: '#29a875' },
  { id: 'roja', name: 'Salita roja', color: '#ed6467' },
  { id: 'azul', name: 'Salita azul', color: '#6388e8' },
];
export const ANIMALS = ['gato', 'perro', 'conejo', 'oso', 'mariposa', 'pez'];
export const COLORS = [
  { name: 'Rojo', hex: '#e34444' }, { name: 'Azul', hex: '#3869ce' },
  { name: 'Verde', hex: '#46a15b' }, { name: 'Amarillo', hex: '#f2d447' },
  { name: 'Naranja', hex: '#ef8c36' }, { name: 'Violeta', hex: '#9453bb' },
  { name: 'Rosa', hex: '#ea80ab' }, { name: 'Celeste', hex: '#68bce3' },
];
export const PROMPTS = ['Pirámide de cinco personas.', 'Foto adentro de la pileta.', 'Copiar la pose de una foto de referencia.', 'Foto a una persona colorada.', 'Foto con anteojos de sol.'];
export class GameError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function assert(condition, message, status = 400) { if (!condition) throw new GameError(message, status); }
export const scores = () => Object.fromEntries(TEAMS.map(t => [t.id, 0]));
export function emptyGame(id) {
  const base = { status: 'idle', scores: scores(), runId: randomUUID() };
  if (id === 1) return { ...base, players: {}, pending: {}, usedCodes: [], exchanges: [], counts: scores() };
  if (id === 2) return { ...base, players: {}, captures: {} };
  return { ...base, photographers: {}, current: -1, reference: null, prompts: PROMPTS.map(text => ({ text, status: 'idle', submissions: {}, winner: null })) };
}
export function newRoom(code, title) {
  return { code, title, createdAt: Date.now(), version: 0, registrationOpen: true, drawn: false, selectedGame: 0, participants: [], games: { 1: emptyGame(1), 2: emptyGame(2), 3: emptyGame(3) } };
}
export function aliasGroup(name) {
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\p{N}\p{P}\p{Z}\p{S}\s_]/gu, '');
  if (['azu', 'azul'].includes(normalized)) return 'azu';
  if (['juani', 'juano'].includes(normalized)) return 'juani';
  return null;
}
export function shuffle(values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function drawTeams(room, selected = {}) {
  assert(!room.registrationOpen, 'Cerrá las inscripciones antes de sortear.');
  assert(!room.drawn, 'Los equipos ya fueron sorteados.');
  assert(room.participants.length >= 3, 'Se necesitan al menos 3 participantes para formar las tres salitas.');
  const resolved = {};
  for (const group of ['azu', 'juani']) {
    const candidates = room.participants.filter(p => aliasGroup(p.name) === group);
    if (candidates.length > 1) assert(candidates.some(p => p.id === selected[group]), `Confirmá qué inscripción corresponde a ${group === 'azu' ? 'Azu / Azul' : 'Juani / Juano'}.`);
    resolved[group] = candidates.length === 1 ? candidates[0].id : selected[group];
  }
  const order = shuffle(room.participants);
  const teams = shuffle(TEAMS.map(t => t.id));
  order.forEach((p, i) => { p.team = teams[i % 3]; });
  const a = order.find(p => p.id === resolved.azu), b = order.find(p => p.id === resolved.juani);
  if (a && b && a.team === b.team) {
    const other = shuffle(order.filter(p => p.team !== a.team))[0];
    [b.team, other.team] = [other.team, b.team];
  }
  room.drawn = true;
  room.aliasSelection = resolved;
}

function code(game) {
  assert(game.usedCodes.length < 10000, 'Se agotaron los códigos de esta ronda.');
  let result;
  do { result = String(randomInt(10000)).padStart(4, '0'); } while (game.usedCodes.includes(result));
  game.usedCodes.push(result);
  return result;
}
function rotate(game, id, animal, notice) {
  const old = game.players[id];
  game.players[id] = { ...old, animal, code: code(game), notice: notice || old?.notice || null };
  for (const [from, attempt] of Object.entries(game.pending)) if (from === id || attempt.to === id) delete game.pending[from];
}
// Membership never changes on connection events. Only a confirmed pair rotates.
export function rotationOptions(game, a, b, onlineIds) {
  const source = game.players[a].animal;
  const all = Object.values(game.players).filter(p => p.animal === source).length;
  const connected = [...onlineIds].filter(id => game.players[id]?.animal === source).length;
  if (all - 2 === 1 || connected - 2 === 1) return [];
  const candidates = ANIMALS.filter(animal => animal !== source).map(animal => ({
    animal,
    total: Object.values(game.players).filter(p => p.animal === animal).length,
    online: [...onlineIds].filter(id => game.players[id]?.animal === animal).length,
  }));
  // Restore mobility to triples first; otherwise meet players who are online.
  const triples = candidates.filter(c => c.total === 3 || c.online === 3);
  const occupied = candidates.filter(c => c.online > 0);
  const registered = candidates.filter(c => c.total > 0);
  return (triples.length ? triples : occupied.length ? occupied : registered.length ? registered : candidates).map(c => c.animal);
}
export function canExchange(game, a, b, onlineIds) {
  const first = game.players[a], second = game.players[b];
  if (!first || !second || a === b || !onlineIds.has(a) || !onlineIds.has(b) || first.animal !== second.animal) return false;
  if (!rotationOptions(game, a, b, onlineIds).length) return false;
  if (first.lastPartner === b && second.lastPartner === a) {
    const alternatives = [...onlineIds].filter(id => id !== a && id !== b && game.players[id]?.animal === first.animal);
    // Each player has at most one forbidden immediate partner. Check actual options.
    const hasOther = id => alternatives.some(other => !(game.players[id].lastPartner === other && game.players[other].lastPartner === id));
    if (hasOther(a) && hasOther(b)) return false;
  }
  return true;
}
export function colorChallenge(previous) {
  const color = shuffle(COLORS.filter(c => c.name !== previous?.name))[0];
  return { ...color, id: randomUUID() };
}
export function activeRound(room) {
  if (room.games[1].status === 'active') return 1;
  if (room.games[2].status === 'active') return 2;
  if (room.games[3].prompts.some(p => p.status === 'active')) return 3;
  return null;
}
export function closeRound(room, id, now = Date.now()) {
  const game = room.games[id];
  if (id === 3) {
    const prompt = game.prompts[game.current];
    if (prompt?.status === 'active') { prompt.status = 'closed'; prompt.closedAt = now; }
    if (game.current === 4) game.status = 'finished';
  } else if (game.status === 'active') {
    game.status = 'finished'; game.endsAt = Math.min(game.endsAt, now);
    if (id === 1) game.pending = {};
  }
}
export function expireRounds(room, now = Date.now()) {
  let changed = false;
  for (const id of [1, 2]) if (room.games[id].status === 'active' && now >= room.games[id].endsAt) { closeRound(room, id, now); changed = true; }
  return changed;
}
export function navigate(room, selected, confirmed) {
  assert(Number.isInteger(selected) && selected >= 0 && selected <= 4, 'Pantalla inválida.');
  if (room.selectedGame === selected) return;
  const active = activeRound(room);
  assert(!active || confirmed === true, 'Hay una ronda activa. Confirmá su cierre antes de cambiar de juego.', 409);
  if (active) closeRound(room, active);
  room.selectedGame = selected;
}
export function startGame(room, id, onlineIds, now = Date.now()) {
  assert(room.drawn, 'Primero sorteá los equipos.');
  assert([1, 2, 3].includes(id), 'Juego inválido.');
  assert(!activeRound(room), 'Primero cerrá la ronda activa.');
  const game = room.games[id];
  assert(game.status === 'idle', 'Este juego ya se inició. Reinicialo para jugar otra vez.', 409);
  if (id === 1) {
    assert(room.participants.length >= 4 && onlineIds.size >= 4, 'Se necesitan al menos 4 jugadores y 4 conectados. Con 3, cambiar solo a la dupla dejaría a una persona sin compañero.');
    // All groups are even except at most one odd group. For 34/35/36 this
    // starts with large groups; moving pairs preserves this parity invariant.
    const people = shuffle(room.participants), animals = shuffle(ANIMALS);
    const groups = Math.min(ANIMALS.length, Math.max(1, Math.floor(people.length / 6)));
    const sizes = Array(groups).fill(0);
    for (let i = 0; i < Math.floor(people.length / 2); i++) sizes[i % groups] += 2;
    if (people.length % 2) sizes[0]++;
    let offset = 0;
    sizes.forEach((size, index) => {
      for (const p of people.slice(offset, offset + size)) rotate(game, p.id, animals[index]);
      offset += size;
    });
  }
  if (id === 2) for (const p of room.participants) game.players[p.id] = { challenge: colorChallenge(), skips: 0 };
  if (id === 3) {
    for (const team of TEAMS) {
      const members = room.participants.filter(p => p.team === team.id);
      const connected = members.filter(p => onlineIds.has(p.id));
      game.photographers[team.id] = shuffle(connected.length ? connected : members)[0]?.id || null;
    }
  }
  game.status = id === 3 ? 'playing' : 'active'; game.startedAt = now;
  if (id !== 3) game.endsAt = now + 120000;
  room.selectedGame = id;
}
export function exchange(room, player, ownCode, targetCode, onlineIds, now = Date.now()) {
  const game = room.games[1];
  assert(game.status === 'active' && now < game.endsAt, 'La ronda ya terminó.', 409);
  assert(onlineIds.size >= 2 && onlineIds.has(player.id), 'Esperá a que haya al menos dos jugadores conectados.', 409);
  const own = game.players[player.id];
  assert(own && own.code === ownCode, 'Tu código cambió. Usá el código vigente.', 409);
  assert(/^\d{4}$/.test(targetCode), 'Ingresá los 4 dígitos, incluidos los ceros.');
  const target = Object.entries(game.players).find(([, p]) => p.code === targetCode);
  assert(target && target[0] !== player.id && onlineIds.has(target[0]) && target[1].animal === own.animal, 'Ese código no corresponde a otro jugador conectado con tu animal.');
  const [otherId] = target;
  const destinations = rotationOptions(game, player.id, otherId, onlineIds);
  assert(destinations.length, 'Con este animal quedan tres personas conectadas o inscriptas. Esperá a que llegue otra dupla o se reconecte un compañero; tu código y tu intento se conservan.', 409);
  assert(canExchange(game, player.id, otherId, onlineIds), 'Ya intercambiaste con esta persona. Busquen otros compañeros con su animal.', 409);
  assert(game.usedCodes.length <= 9998, 'Se agotaron los códigos de esta ronda. No se aplicó el intercambio.', 409);
  const reverse = game.pending[otherId];
  game.pending[player.id] = { to: otherId, ownCode, targetCode };
  if (!reverse || reverse.to !== player.id || reverse.ownCode !== targetCode || reverse.targetCode !== ownCode) return { confirmed: false, message: 'Código recibido. Esperando que tu compañero ingrese el tuyo.' };
  const other = room.participants.find(p => p.id === otherId);
  const teams = [...new Set([player.team, other.team])];
  const points = teams.length === 1 ? 1 : 2;
  for (const team of teams) { game.scores[team] += points; game.counts[team]++; }
  game.exchanges.push({ id: randomUUID(), players: [player.id, otherId], teams, points, at: now });
  const animal = shuffle(destinations)[0];
  const notice = { id: randomUUID(), text: `¡Intercambio confirmado! +${points} ${points === 1 ? 'punto' : 'puntos'} para tu salita.` };
  rotate(game, player.id, animal, notice); rotate(game, otherId, animal, notice);
  game.players[player.id].lastPartner = otherId;
  game.players[otherId].lastPartner = player.id;
  return { confirmed: true, points, message: notice.text };
}
export function skipColor(room, playerId, challengeId, now = Date.now()) {
  const game = room.games[2], player = game.players[playerId];
  assert(game.status === 'active' && now < game.endsAt, 'La ronda ya terminó.', 409);
  assert(player?.challenge.id === challengeId, 'El color ya cambió. Actualizá el desafío.', 409);
  assert(player.skips < 3, 'Ya usaste los 3 saltos.');
  player.skips++; player.challenge = colorChallenge(player.challenge);
}
export function approveColor(room, player, challengeId, hash, result, now = Date.now()) {
  const game = room.games[2], state = game.players[player.id];
  assert(game.status === 'active' && now < game.endsAt, 'La ronda terminó antes de validar la foto.', 409);
  assert(state?.challenge.id === challengeId, 'Este desafío ya se resolvió o cambió.', 409);
  assert(!game.captures[hash], 'Esta captura ya sumó un punto. Sacá una foto nueva.', 409);
  if (result.accepted) { game.captures[hash] = player.id; game.scores[player.team]++; state.challenge = colorChallenge(state.challenge); }
  return result;
}
export function startPrompt(room, expectedIndex, now = Date.now()) {
  const game = room.games[3];
  assert(game.status === 'playing', 'Primero iniciá el juego de fotos.');
  assert(!activeRound(room), 'Cerrá la ronda actual antes de lanzar otra.');
  const next = game.current + 1;
  assert(next < 5 && next === expectedIndex, 'Esta consigna ya cambió.', 409);
  assert(next !== 2 || game.reference, 'Cargá la foto de referencia antes de lanzar la tercera consigna.');
  game.current = next; game.prompts[next].status = 'active'; game.prompts[next].startedAt = now;
  room.selectedGame = 3;
}
export function submitTeamPhoto(room, player, index, assetId, runId, now = Date.now()) {
  const game = room.games[3], prompt = game.prompts[index];
  assert(game.runId === runId && game.current === index && prompt?.status === 'active', 'La consigna ya se cerró o cambió.', 409);
  assert(game.photographers[player.team] === player.id, 'Solo puede enviar el fotógrafo de tu equipo.', 403);
  assert(!prompt.submissions[player.team], 'Tu equipo ya hizo su entrega final.', 409);
  prompt.submissions[player.team] = { assetId, playerId: player.id, receivedAt: now, elapsedMs: now - prompt.startedAt };
}
export function award(room, index, winner) {
  const game = room.games[3], prompt = game.prompts[index];
  assert(prompt?.status === 'closed', 'Cerrá la consigna antes de adjudicar.');
  assert(winner === null || TEAMS.some(t => t.id === winner), 'Equipo inválido.');
  assert(winner === null || prompt.submissions[winner], 'Ese equipo no entregó una foto.');
  prompt.winner = winner;
  game.scores = scores();
  for (const p of game.prompts) if (p.winner) game.scores[p.winner]++;
}

export function view(room, role, playerId, onlineIds, baseUrl) {
  const me = room.participants.find(p => p.id === playerId);
  const games = {};
  for (const id of [1, 2, 3]) {
    const g = room.games[id];
    games[id] = { status: g.status, scores: g.scores, startedAt: g.startedAt, endsAt: g.endsAt, runId: g.runId };
    if (id === 1) {
      games[id].counts = g.counts;
      games[id].paused = onlineIds.size < 2;
      if (me) {
        const { lastPartner, ...own } = g.players[playerId] || {};
        games[id].me = { ...own, pending: !!g.pending[playerId] };
      }
    }
    if (id === 2 && me) games[id].me = g.players[playerId];
    if (id === 3) {
      Object.assign(games[id], { photographers: g.photographers, current: g.current, reference: g.reference ? `/api/rooms/${room.code}/assets/${g.reference}` : null,
        prompts: g.prompts.map(p => ({ ...p, submissions: Object.fromEntries(Object.entries(p.submissions).map(([team, s]) => [team, role === 'admin' ? { ...s, url: `/api/rooms/${room.code}/assets/${s.assetId}` } : { received: true }])) })) });
    }
  }
  return {
    code: room.code, title: room.title, version: room.version, serverNow: Date.now(), role, me,
    registrationOpen: room.registrationOpen, drawn: room.drawn, selectedGame: room.selectedGame, games, teams: TEAMS,
    participants: room.participants.map(p => ({ id: p.id, name: p.name, team: p.team, online: onlineIds.has(p.id), ...(role === 'admin' ? { alias: aliasGroup(p.name) } : {}) })),
    joinUrl: `${baseUrl}/sala/${room.code}`,
    totals: Object.fromEntries(TEAMS.map(t => [t.id, [1, 2, 3].reduce((n, id) => n + room.games[id].scores[t.id], 0)])),
  };
}
