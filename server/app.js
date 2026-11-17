import express from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { transaction } from './db.js';
import { cookies, createSession, digest, getSession, verifyPassword } from './auth.js';
import { decodePhoto, validateColor } from './images.js';
import { GameError, assert, newRoom, drawTeams, view, expireRounds, startGame, closeRound, navigate, emptyGame, exchange, skipColor, approveColor, startPrompt, submitTeamPhoto, award, TEAMS } from './game.js';

export function createApp(db, config = {}) {
  const app = express();
  const production = config.production ?? process.env.NODE_ENV === 'production';
  const publicUrl = (config.publicUrl || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  const deltaE = Number(config.deltaE ?? process.env.COLOR_DELTA_E ?? 32);
  const coverage = Number(config.coverage ?? process.env.COLOR_MIN_COVERAGE ?? .25);
  if (!(deltaE > 0 && deltaE <= 100 && coverage >= .1 && coverage <= 1)) throw new Error('Configuración de validación de color inválida.');
  if (production && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL debe usar HTTPS en producción.');
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const streams = new Map(), rateLimits = new Map();
  const online = code => new Set([...(streams.get(code) || [])].filter(c => c.role === 'guest' && !c.res.destroyed).map(c => c.playerId));
  const load = code => {
    const row = db.prepare('SELECT * FROM rooms WHERE code=?').get(code);
    assert(row, 'No encontramos esa sala. Revisá el código.', 404);
    return { ...row, state: JSON.parse(row.state) };
  };
  const save = room => { room.version++; db.prepare('UPDATE rooms SET state=? WHERE code=?').run(JSON.stringify(room), room.code); };
  function broadcast(code) {
    const room = load(code).state, ids = online(code);
    for (const c of streams.get(code) || []) {
      if (c.role === 'guest' && !room.participants.some(p => p.id === c.playerId)) {
        c.res.write('event: reset\ndata: {}\n\n');
        streams.get(code)?.delete(c);
        c.res.end();
        continue;
      }
      if (!c.res.destroyed) c.res.write(`data: ${JSON.stringify(view(room, c.role, c.playerId, ids, publicUrl))}\n\n`);
    }
  }
  function mutate(code, fn) {
    const result = transaction(db, () => {
      const room = load(code).state;
      expireRounds(room);
      const result = fn(room);
      save(room);
      return result;
    });
    broadcast(code);
    return result;
  }
  function rate(req, key, maximum, windowMs) {
    const now = Date.now(), id = `${key}:${req.access?.playerId || req.ip}`;
    let entry = rateLimits.get(id);
    if (!entry || now > entry.until) { entry = { count: 0, until: now + windowMs }; rateLimits.set(id, entry); }
    assert(++entry.count <= maximum, 'Demasiados intentos. Esperá un momento y volvé a probar.', 429);
  }
  const admin = (req, res, next) => {
    req.admin = getSession(db, req, 'admin');
    assert(req.admin, 'Iniciá sesión como administrador.', 401); next();
  };
  const access = (req, res, next) => {
    req.params.code = req.params.code.toUpperCase();
    const row = load(req.params.code);
    // Guest view stays a guest even when its browser also has an admin session.
    const adminSession = req.query.role === 'admin' || req.path.includes('/admin/') ? getSession(db, req, 'admin') : null;
    if (adminSession && row.owner === adminSession.subject) req.access = { role: 'admin', playerId: null, expires: adminSession.expires };
    else {
      const guest = getSession(db, req, 'guest');
      assert(guest && row.state.participants.some(p => p.id === guest.subject), 'Entrá a esta sala para continuar.', 401);
      req.access = { role: 'guest', playerId: guest.subject, expires: guest.expires };
    }
    req.room = row.state; next();
  };
  const owned = (req, res, next) => {
    req.params.code = req.params.code.toUpperCase();
    const row = load(req.params.code);
    assert(row.owner === req.admin.subject, 'No tenés permiso para administrar esta sala.', 403);
    req.room = row.state; next();
  };
  const playerIn = (room, req) => {
    assert(req.access.role === 'guest', 'Esta acción es para participantes.', 403);
    const p = room.participants.find(p => p.id === req.access.playerId);
    assert(p?.team, 'Esperá el sorteo de equipos.', 409); return p;
  };
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      assert(!req.headers.origin || req.headers.origin === new URL(publicUrl).origin, 'Origen de la solicitud no permitido.', 403);
      assert(req.headers['x-cumple-request'] === '1', 'Solicitud no permitida.', 403);
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/party', (req, res) => {
    const room = db.prepare('SELECT code FROM rooms ORDER BY rowid LIMIT 1').get();
    res.json({ code: room?.code || null });
  });
  app.post('/api/admin/party', admin, (req, res) => {
    let room = db.prepare('SELECT code, owner FROM rooms ORDER BY rowid LIMIT 1').get();
    if (!room) {
      const code = randomUUID().slice(0, 6).toUpperCase();
      db.prepare('INSERT INTO rooms VALUES (?,?,?)').run(code, req.admin.subject, JSON.stringify(newRoom(code, 'Desafío Homer')));
      room = { code, owner: req.admin.subject };
    }
    assert(room.owner === req.admin.subject, 'La fiesta pertenece a otra cuenta administrativa.', 403);
    res.json({ code: room.code });
  });
  app.post('/api/admin/login', (req, res) => {
    rate(req, 'login', 15, 15 * 60000);
    const { username, password } = req.body || {};
    assert(typeof username === 'string' && typeof password === 'string' && password.length <= 256, 'Completá usuario y contraseña.');
    const account = db.prepare('SELECT * FROM admins WHERE username=?').get(username.trim().toLowerCase());
    assert(account && verifyPassword(password, account.password), 'Usuario o contraseña incorrectos.', 401);
    const previous = cookies(req).cumple_admin;
    if (previous) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(previous));
    createSession(db, res, 'admin', account.id, production); res.json({ ok: true });
  });
  app.post('/api/admin/logout', admin, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token=?').run(req.admin.token);
    res.clearCookie('cumple_admin', { path: '/' });
    for (const clients of streams.values()) for (const c of clients) if (c.role === 'admin' && c.adminId === req.admin.subject) c.res.end();
    res.json({ ok: true });
  });
  app.get('/api/admin/rooms', admin, (req, res) => {
    res.json({ rooms: db.prepare('SELECT state FROM rooms WHERE owner=? ORDER BY rowid DESC').all(req.admin.subject).map(row => { const r = JSON.parse(row.state); return { code: r.code, title: r.title, count: r.participants.length, drawn: r.drawn }; }) });
  });
  app.post('/api/admin/rooms', admin, (req, res) => {
    rate(req, 'create', 20, 60000);
    const title = String(req.body.title || 'El cumple de Homero').trim().slice(0, 80);
    let code;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (db.prepare('SELECT code FROM rooms WHERE code=?').get(code));
    const room = newRoom(code, title);
    db.prepare('INSERT INTO rooms VALUES (?,?,?)').run(code, req.admin.subject, JSON.stringify(room));
    res.status(201).json({ code });
  });
  app.post('/api/rooms/:code/join', (req, res) => {
    rate(req, 'join', 90, 60000);
    const code = req.params.code.toUpperCase(), row = load(code);
    let session = getSession(db, req, 'guest');
    const existing = row.state.participants.find(p => p.id === session?.subject);
    if (existing) return res.json({ code, id: existing.id });
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    assert(name.length >= 1 && name.length <= 40 && !/[\p{C}]/u.test(name), 'Escribí un nombre de entre 1 y 40 caracteres.');
    assert(row.state.registrationOpen && !row.state.drawn, 'Las inscripciones de esta sala están cerradas.', 409);
    assert(row.state.participants.length < 150, 'La sala llegó al máximo de 150 participantes.');
    const id = session?.subject || randomUUID();
    mutate(code, room => { room.participants.push({ id, name, team: null, joinedAt: Date.now() }); });
    if (!session) createSession(db, res, 'guest', id, production);
    res.json({ code, id });
  });
  app.get('/api/rooms/:code/state', access, (req, res) => {
    if (expireRounds(req.room)) { save(req.room); broadcast(req.room.code); }
    res.json(view(req.room, req.access.role, req.access.playerId, online(req.room.code), publicUrl));
  });
  app.get('/api/rooms/:code/events', access, (req, res) => {
    const code = req.room.code;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const client = { ...req.access, res, adminId: req.access.role === 'admin' ? getSession(db, req, 'admin')?.subject : null };
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(client);
    broadcast(code);
    req.on('close', () => {
      streams.get(code)?.delete(client);
      if (!streams.get(code)?.size) streams.delete(code);
      broadcast(code);
    });
  });
  app.get('/api/rooms/:code/qr', admin, owned, async (req, res) => {
    const svg = await QRCode.toString(`${publicUrl}/`, { type: 'svg', margin: 2, width: 240, color: { dark: '#29263fff', light: '#ffffffff' } });
    res.type('svg').send(svg);
  });
  app.post('/api/rooms/:code/admin/action', admin, owned, (req, res) => {
    const b = req.body || {};
    mutate(req.room.code, room => {
      switch (b.action) {
        case 'reset-party': {
          assert(b.confirmed === true, 'Confirmá que querés borrar todos los participantes, equipos y resultados.');
          assert(b.runId === room.games[1].runId, 'La fiesta ya fue reiniciada. Actualizá la pantalla.', 409);
          const fresh = newRoom(room.code, room.title);
          fresh.version = room.version;
          for (const key of Object.keys(room)) delete room[key];
          Object.assign(room, fresh);
          db.prepare('DELETE FROM assets WHERE room=?').run(room.code);
          break;
        }
        case 'registration': assert(!room.drawn, 'Los equipos ya están sorteados.'); room.registrationOpen = b.open === true; break;
        case 'draw': drawTeams(room, b.aliases); break;
        case 'navigate': navigate(room, b.game, b.confirmed); break;
        case 'start': startGame(room, b.game, online(room.code)); break;
        case 'close': {
          assert([1, 2, 3].includes(b.game), 'Juego inválido.');
          assert(room.games[b.game].runId === b.runId, 'El juego cambió. Actualizá la pantalla.', 409);
          if (b.game === 3) assert(room.games[3].current === b.index, 'La consigna cambió.', 409);
          closeRound(room, b.game); break;
        }
        case 'reset': {
          assert([1, 2, 3].includes(b.game) && b.confirmed === true, 'Confirmá el reinicio del juego.');
          assert(room.games[b.game].runId === b.runId, 'Este juego ya fue reiniciado.', 409);
          room.games[b.game] = emptyGame(b.game);
          db.prepare('DELETE FROM assets WHERE room=? AND game=?').run(room.code, b.game); break;
        }
        case 'prompt': assert(room.games[3].runId === b.runId, 'El juego cambió.', 409); startPrompt(room, b.index); break;
        case 'photographer': {
          assert(room.games[3].status !== 'idle', 'Primero iniciá el juego.');
          assert(room.participants.some(p => p.id === b.playerId && p.team === b.team), 'Elegí una persona de ese equipo.');
          room.games[3].photographers[b.team] = b.playerId; break;
        }
        case 'award': assert(room.games[3].runId === b.runId, 'El juego cambió.', 409); award(room, b.index, b.winner); break;
        default: throw new GameError('Acción desconocida.');
      }
    });
    res.json({ ok: true });
  });
  app.post('/api/rooms/:code/exchange', access, (req, res) => {
    rate(req, 'exchange', 240, 60000);
    const result = mutate(req.room.code, room => exchange(room, playerIn(room, req), req.body.ownCode, req.body.targetCode, online(room.code)));
    res.json(result);
  });
  app.post('/api/rooms/:code/skip', access, (req, res) => {
    mutate(req.room.code, room => skipColor(room, playerIn(room, req).id, req.body.challengeId)); res.json({ ok: true });
  });
  const photoBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '8mb' });
  let processingPhotos = 0;
  const decode = async req => {
    rate(req, 'photos', 150, 60000);
    assert(processingPhotos < 8, 'Estamos procesando varias fotos. Reintentá en un momento.', 503);
    processingPhotos++;
    try { return await decodePhoto(req.body); }
    catch (error) { throw new GameError(error.message.includes('foto') || error.message.includes('Usá') ? error.message : 'No pudimos leer la foto. Sacá otra y reintentá.'); }
    finally { processingPhotos--; }
  };
  app.post('/api/rooms/:code/color-photo', access, photoBody, async (req, res) => {
    const player = playerIn(req.room, req), challengeId = req.headers['x-challenge-id'];
    const current = req.room.games[2].players[player.id]?.challenge;
    assert(current?.id === challengeId && req.room.games[2].status === 'active', 'Este desafío ya cambió o terminó.', 409);
    const photo = await decode(req);
    const result = validateColor(photo.pixels, current.hex, deltaE, coverage);
    mutate(req.room.code, room => approveColor(room, playerIn(room, req), challengeId, photo.hash, result));
    res.json({ ...result, message: result.accepted ? '¡Color encontrado! +1 punto para tu salita.' : `Coincide el ${result.coverage}% del centro. Acercá el objeto y probá con mejor luz.` });
  });
  app.post('/api/rooms/:code/team-photo', access, photoBody, async (req, res) => {
    const receivedAt = Date.now(), index = Number(req.headers['x-prompt-index']), runId = req.headers['x-run-id'];
    const initialPlayer = playerIn(req.room, req);
    assert(req.room.games[3].photographers[initialPlayer.team] === initialPlayer.id, 'Solo puede enviar el fotógrafo de tu equipo.', 403);
    const photo = await decode(req), assetId = randomUUID();
    mutate(req.room.code, room => {
      submitTeamPhoto(room, playerIn(room, req), index, assetId, runId, receivedAt);
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(assetId, room.code, 3, 'submission', photo.bytes);
    });
    res.json({ ok: true, message: '¡Foto entregada! Tu equipo ya está participando.' });
  });
  app.post('/api/rooms/:code/admin/reference', admin, owned, photoBody, async (req, res) => {
    const photo = await decode(req), assetId = randomUUID();
    mutate(req.room.code, room => {
      assert(room.games[3].runId === req.headers['x-run-id'], 'El juego cambió.', 409);
      assert(room.games[3].prompts[2].status === 'idle', 'La tercera consigna ya se lanzó.');
      if (room.games[3].reference) db.prepare('DELETE FROM assets WHERE id=?').run(room.games[3].reference);
      db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(assetId, room.code, 3, 'reference', photo.bytes);
      room.games[3].reference = assetId;
    });
    res.json({ ok: true });
  });
  app.get('/api/rooms/:code/assets/:asset', access, (req, res) => {
    const asset = db.prepare('SELECT * FROM assets WHERE id=? AND room=?').get(req.params.asset, req.room.code);
    assert(asset, 'La foto ya no está disponible.', 404);
    assert(req.access.role === 'admin' || (asset.kind === 'reference' && req.room.games[3].prompts[2].status !== 'idle'), 'No tenés permiso para ver esta foto.', 403);
    res.type('jpeg').send(Buffer.from(asset.bytes));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use(express.static(resolve(import.meta.dirname, '../public')));
  app.get(['/', '/admin', '/admin/:code', '/sala/:code'], (req, res) => res.sendFile(resolve(import.meta.dirname, '../public/index.html')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'No pudimos completar la acción. Reintentá.' : status === 413 ? 'La foto es demasiado grande. Máximo 8 MB.' : error.message });
  });
  const ticker = setInterval(() => {
    for (const row of db.prepare('SELECT state FROM rooms').all()) {
      const room = JSON.parse(row.state);
      if (expireRounds(room)) { save(room); broadcast(room.code); }
    }
  }, 500);
  const heartbeat = setInterval(() => {
    for (const clients of streams.values()) for (const c of clients) {
      if (c.expires <= Date.now()) c.res.end();
      else c.res.write(`: heartbeat ${Date.now()}\n\n`);
    }
    for (const [key, entry] of rateLimits) if (entry.until < Date.now()) rateLimits.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  }, 15000);
  ticker.unref(); heartbeat.unref();
  return { app, online, stop() { clearInterval(ticker); clearInterval(heartbeat); for (const clients of streams.values()) for (const c of clients) c.res.end(); } };
}
