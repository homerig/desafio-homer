const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = ['La previa', 'Encontrá tu animal', 'Cazá el color', 'Desafío de fotos', 'Resultados finales'];
const symbols = { verde: '<svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>', roja: '✿', azul: '✦' };
let state = null, source = null, serverOffset = 0, connected = false, loading = false, lastNotice = null;
let camera = null, review = null;
const path = location.pathname.split('/').filter(Boolean);
const isAdmin = path[0] === 'admin';
let roomCode = (path[1] || '').toUpperCase();
const brand = '<a href="/" class="brand"><span class="brand-mark" aria-hidden="true"><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></span>Desafío Homer</a>';
const footer = '<p class="footer-note">Hecho para jugar juntos. Y festejar a lo grande.</p>';

async function api(url, body, headers = {}) {
  const options = { credentials: 'same-origin', headers: { 'X-Cumple-Request': '1', ...headers } };
  if (body !== undefined) {
    options.method = 'POST';
    if (body instanceof Blob) { options.body = body; options.headers['Content-Type'] = body.type || 'image/jpeg'; }
    else { options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; }
  }
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'No pudimos completar la acción.'); error.status = response.status; throw error; }
  return data;
}
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toasts').append(el); setTimeout(() => el.remove(), 5500);
}
function teamName(team) { return state?.teams.find(t => t.id === team)?.name || 'Sin equipo'; }
function personName(id) { return state?.participants.find(p => p.id === id)?.name || 'Sin asignar'; }
function onlineCount() { return state.participants.filter(p => p.online).length; }
function activeGame() { return [1, 2].find(id => state.games[id].status === 'active') || (state.games[3].prompts.some(p => p.status === 'active') ? 3 : null); }
function remaining(id) { return Math.max(0, (state.games[id].endsAt || 0) - (Date.now() + serverOffset)); }
function formatTime(ms) { const sec = Math.ceil(ms / 1000); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }
function elapsed(ms) { return `${(ms / 1000).toFixed(2).replace('.', ',')} s`; }
function connectionHtml() { return `<span class="connection ${connected ? '' : 'offline'}"><span class="dot ${connected ? 'online' : ''}"></span>${connected ? 'En vivo · todo sincronizado' : 'Reconectando…'}</span>`; }
function scoreCards(game) {
  const values = game ? state.games[game].scores : state.totals;
  return `<div class="score-grid">${state.teams.map(t => `<article class="score-card ${t.id}"><div class="team-name"><span class="team-symbol">${symbols[t.id]}</span>${t.name}</div><div class="number">${values[t.id]}<small>pts</small></div><span class="score-decoration" aria-hidden="true">${symbols[t.id]}</span><div class="details">${game === 1 ? `${state.games[1].counts[t.id]} intercambios válidos` : game ? 'En este juego' : `Animal ${state.games[1].scores[t.id]} · Color ${state.games[2].scores[t.id]} · Fotos ${state.games[3].scores[t.id]}`}</div></article>`).join('')}</div>`;
}
function roster(list = state.participants) {
  if (!list.length) return '<div class="empty"><span class="empty-symbol"><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></span>Todo listo para recibirlos.<br>Compartí el QR y que se sume la banda.</div>';
  return `<div class="roster">${list.map(p => `<div class="person"><span class="avatar ${p.team || ''}">${esc(p.name.slice(0, 2).toUpperCase())}</span><div class="grow"><div class="person-name">${esc(p.name)}${p.id === state.me?.id ? ' <span class="muted">(vos)</span>' : ''}</div><div class="person-meta">${p.team ? teamName(p.team) : 'Esperando el sorteo'}</div></div><span class="pill"><span class="dot ${p.online ? 'online' : ''}"></span>${p.online ? 'En línea' : 'Sin conexión'}</span></div>`).join('')}</div>`;
}
function sharePanel() {
  return `<section class="panel share-panel"><p class="eyebrow">La fiesta empieza acá</p><h2 style="font-size:1.4rem;margin-top:10px">Una invitación a jugar</h2><img class="qr" src="/api/rooms/${roomCode}/qr" alt="Código QR para entrar a la sala"><p class="small">Escaneá el QR y entrá con tu nombre.</p><button class="btn light full" data-action="copy">↗ Copiar invitación</button></section>`;
}
function landing() {
  root.innerHTML = `<header class="topbar">${brand}<a href="/admin" class="admin-link">Soy el anfitrión ↗</a></header><main class="landing"><section class="hero-copy"><div class="eyebrow">Un cumple. Tres equipos. Muchos recuerdos.</div><h1>Hoy se festeja.<br>Hoy se <em>juega.</em></h1><p>Buscá tu salita, sumá puntos y dejá todo en la cancha. La mejor parte es jugar juntos.</p><form id="join-form" class="join-form"><label>¿Cómo te llamás?<input name="name" placeholder="El nombre por el que todos te conocen" maxlength="40" required autocomplete="nickname"></label><div class="error-inline" id="form-error" role="alert"></div><button class="btn full" type="submit">Entrar a la fiesta <span aria-hidden="true">↗</span></button><p class="form-note">No necesitás una cuenta. Solo tu nombre y ganas de jugar.<br>Usá este mismo navegador para volver a tu partida.</p></form></section><div class="hero-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-orbit second"></div><div class="art-star"><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></div><div class="party-ticket"><div class="ticket-top"><span>BIENVENIDOS · DESAFÍO HOMER</span><span>↗</span></div><div class="ticket-title">La banda.<br>La fiesta.<br><span>El jueguito.</span></div><div class="ticket-bottom">TU ENTRADA A UN GRAN RECUERDO</div></div><div class="team-stickers"><div class="team-sticker verde"><b><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></b><span>SALITA VERDE</span></div><div class="team-sticker roja"><b>✿</b><span>SALITA ROJA</span></div><div class="team-sticker azul"><b>✦</b><span>SALITA AZUL</span></div></div><div class="art-caption">3 EQUIPOS &nbsp;·&nbsp; 3 JUEGOS &nbsp;·&nbsp; UNA SOLA FIESTA</div></div></main><footer class="landing-footer"><div class="mini-game"><span class="mini-icon">♧</span><div>Encontrá tu animal<small>Un compañero, un código, un match.</small></div></div><div class="mini-game"><span class="mini-icon">◉</span><div>Cazá el color<small>El mundo es tu paleta.</small></div></div><div class="mini-game"><span class="mini-icon">▣</span><div>Desafío de fotos<small>Tu equipo, su mejor pose.</small></div></div></footer>`;
}
function login() {
  root.innerHTML = `<header class="topbar">${brand}<a href="/" class="admin-link">Volver a la fiesta ↗</a></header><main class="login-shell stack"><span class="eyebrow">Detrás de la fiesta</span><h1>Vos tenés<br>el control.</h1><p class="muted small">Entrá a tu panel para armar los equipos y dar comienzo a los juegos.</p><form id="login-form" class="stack"><label>Usuario<input name="username" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><div class="error-inline" id="form-error" role="alert"></div><button class="btn full">Entrar al panel ↗</button></form><p class="form-note">Acceso exclusivo para el anfitrión.</p></main>`;
}
async function roomList() {
  const party = await api('/api/admin/party', {});
  location.replace(`/admin/${party.code}`);
}
function drawPanel() {
  const groups = ['azu', 'juani'].map(alias => ({ alias, people: state.participants.filter(p => p.alias === alias) })).filter(g => g.people.length > 1);
  return `<section class="panel"><div class="panel-header"><h2>Armemos las salitas</h2><span><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></span></div><p class="small muted">Tres equipos al azar, con tamaños parejos. Azu / Azul y Juani / Juano quedan en salitas distintas.</p>${groups.length ? `<div class="alias-box"><p class="small">Hay más de una inscripción con estos alias. Confirmá quién es cada persona antes de sortear.</p>${groups.map(g => `<label>${g.alias === 'azu' ? 'Azu / Azul' : 'Juani / Juano'}<select data-preserve id="alias-${g.alias}"><option value="">Elegí la inscripción correcta</option>${g.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}<div class="actions">${state.registrationOpen ? '<button class="btn full" data-action="registration" data-open="false">Cerrar inscripciones</button>' : '<button class="btn purple full" data-action="draw"><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg> Sortear los equipos</button><button class="btn light full" data-action="registration" data-open="true">Reabrir inscripciones</button>'}</div><p class="form-note" style="margin-top:12px">Mínimo 3 participantes. El sorteo fija los equipos para toda la fiesta.</p></section>`;
}
function adminLobby() {
  return `<div class="content-grid"><div class="stack"><section class="panel"><div class="panel-header"><div><p class="eyebrow">La previa</p><h2>La banda se está juntando</h2></div><span class="pill">${state.participants.length} invitados</span></div>${roster()}</section>${state.drawn ? `<div class="notice">¡Las salitas están listas! Cada invitado ya puede ver su equipo. Elegí un juego para empezar.</div>` : drawPanel()}</div><aside class="stack">${sharePanel()}<div class="notice"><strong>Todo queda guardado.</strong><br>Si alguien recarga o pierde señal, vuelve con su mismo equipo y progreso desde este navegador.</div></aside></div>`;
}
function gameRules(id) {
  const rules = {
    1: [
      'Tenés 2 minutos para buscar a alguien con tu misma silueta.',
      'Intercambien sus códigos de 4 dígitos: los dos deben ingresar el código del otro para confirmar.',
      'Misma salita: 1 punto total. Salitas distintas: 2 puntos para cada una.',
      'Después de confirmar, cambian el animal y el código de esa dupla. Buscá un nuevo compañero cuando haya otras opciones.',
      'Si quedan tres personas con tu animal, esperá a que llegue otra dupla. Tu código se conserva.',
    ],
    2: [
      'Tenés 2 minutos para fotografiar objetos del color que aparece en tu pantalla.',
      'Llená el centro de la guía con el objeto y buscá buena luz. Se aceptan tonos similares.',
      'Cada foto aprobada suma 1 punto a tu salita y te da un nuevo color.',
      'Si la foto no se aprueba, podés reintentar con el mismo color. Una misma captura no vuelve a sumar.',
      'Podés saltar hasta 3 colores durante toda la ronda. Saltar no da puntos.',
    ],
    3: [
      'Se sortea un fotógrafo por salita. Todos ayudan a cumplir la consigna, pero solo esa persona envía la foto.',
      'Hay cinco consignas, una por vez. Cada consigna aparece al mismo tiempo para los tres equipos.',
      'La velocidad importa: organicen la escena, saquen la foto y envíenla lo más rápido posible, sin dejar de cumplir la consigna.',
      'El tiempo cuenta desde que se lanza la consigna hasta que se recibe la foto enviada. También cuenta el tiempo que tardan en revisarla y subirla.',
      'El fotógrafo puede revisar la captura antes de enviarla. Hay una sola entrega final por equipo y consigna.',
      'Homero revisa si las fotos cumplen y usa el tiempo hasta el envío para adjudicar 1 punto a un equipo; también puede dejar la consigna sin ganador.',
    ],
  };
  return rules[id].map(rule => `<li>${rule}</li>`).join('');
}
function waitingRules(id) {
  return `<section class="panel waiting-rules"><p class="eyebrow">Cómo se juega · Juego 0${id}</p><h2>${names[id]}</h2><ul class="rules">${gameRules(id)}</ul></section>`;
}
function resultMessage(game) {
  const values = state.games[game].scores, max = Math.max(...Object.values(values));
  const winners = state.teams.filter(t => values[t.id] === max);
  return `${winners.length > 1 ? 'Empate' : 'Ganó'}: ${winners.map(t => t.name).join(' + ')} · ${max} ${max === 1 ? 'punto' : 'puntos'}`;
}
function adminTimedGame(id) {
  const g = state.games[id], active = g.status === 'active', done = g.status === 'finished';
  return `<div class="content-grid"><section class="panel"><div class="game-banner ${id === 2 ? 'color-banner' : ''}"><p class="eyebrow">Juego 0${id} · 2 minutos</p><h2>${names[id]}</h2><p>${id === 1 ? 'La mejor conexión de la fiesta empieza con el mismo animal.' : 'Buscá el color. Encontrá el objeto. Sumá para tu salita.'}</p><span class="banner-icon" aria-hidden="true">${id === 1 ? '♧' : '◉'}</span></div>${active ? `<div class="timer-box"><p class="eyebrow">La ronda está en marcha</p><div class="timer" data-timer="${id}">${formatTime(remaining(id))}</div></div>` : done ? `<div class="notice">${resultMessage(id)}</div>` : '<div class="notice">La ronda empieza para todos al mismo tiempo y se cierra automáticamente a los 2 minutos.</div>'}${scoreCards(id)}<ul class="rules">${gameRules(id)}</ul>${id === 1 ? `<p class="form-note" style="margin-top:18px">Mínimo 4 jugadores conectados. Con 3 no se puede iniciar: mover solo a la dupla dejaría a una persona aislada. Si tu animal reúne tres personas, esperá a otra dupla; nadie cambia por una desconexión. Después de intercambiar, buscá otra pareja cuando haya compañeros disponibles.</p>` : ''}<div class="actions">${g.status === 'idle' ? `<button class="btn grow" data-action="start" data-game="${id}" ${!state.drawn || (id === 1 && onlineCount() < 4) ? 'disabled' : ''}>▶ Iniciar los 2 minutos</button>` : active ? `<button class="btn light grow" data-action="close" data-game="${id}">Cerrar ronda ahora</button>` : ''}<button class="btn danger" data-action="reset" data-game="${id}">↺ Reiniciar juego</button></div>${!state.drawn ? '<p class="form-note" style="margin-top:12px">Primero cerrá las inscripciones y sorteá los equipos en La previa.</p>' : ''}</section><aside class="stack"><section class="panel"><div class="panel-header"><h2>En la fiesta</h2><span class="pill">${onlineCount()} en línea</span></div>${roster()}</section><button class="btn light" data-action="navigate" data-game="${id + 1}">Siguiente juego →</button></aside></div>`;
}
function adminPhotos() {
  const g = state.games[3], p = g.prompts[g.current];
  return `<div class="content-grid"><section class="panel"><div class="game-banner photo-banner"><p class="eyebrow">Juego 03 · Una foto, mil recuerdos</p><h2>Desafío de fotos</h2><p>Tres equipos, una consigna y un fotógrafo por salita.</p><span class="banner-icon" aria-hidden="true">▣</span></div>${g.status === 'idle' ? `<p class="small muted">Sorteá un fotógrafo por equipo. Después, lanzá cada consigna para los tres equipos al mismo tiempo.</p><button class="btn full" style="margin-top:20px" data-action="start" data-game="3" ${state.drawn ? '' : 'disabled'}><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg> Sortear fotógrafos e iniciar juego</button>` : `<div class="notice">${p?.status === 'active' ? `<strong>Consigna ${g.current + 1} activa</strong><br>${esc(p.text)}` : g.current === 4 ? 'Las cinco consignas están cerradas. Podés revisar y corregir los ganadores.' : 'Listos para la próxima consigna. Los equipos la recibirán al mismo tiempo.'}</div>${p?.status === 'active' ? `<div style="margin-top:15px">${state.teams.map(t => `<div class="delivery"><strong>${t.name}</strong><span>${p.submissions[t.id] ? `✓ Entregó <small>· ${elapsed(p.submissions[t.id].elapsedMs)}</small>` : '<small>Esperando foto</small>'}</span></div>`).join('')}</div><button class="btn full" style="margin-top:20px" data-action="close" data-game="3">Cerrar consigna y revisar</button>` : g.current < 4 ? `<button class="btn full" style="margin-top:20px" data-action="prompt" ${g.current === 1 && !g.reference ? 'disabled' : ''}>Lanzar consigna ${g.current + 2} →</button>` : ''}`}<div class="divider"></div><h3>El recorrido</h3>${g.prompts.map((q, i) => `<div class="round-row"><span class="round-number">${i + 1}</span><div class="grow"><p>${esc(q.text)}</p><small>${q.status === 'closed' ? q.winner ? `1 punto · ${teamName(q.winner)}` : 'Cerrada · sin ganador' : q.status === 'active' ? `${Object.keys(q.submissions).length}/3 entregas` : 'Por jugar'}</small></div>${q.status === 'closed' ? `<button class="btn light small" data-action="review" data-index="${i}">Revisar ↗</button>` : ''}</div>`).join('')}<div class="actions"><button class="btn danger" data-action="reset" data-game="3">↺ Reiniciar juego de fotos</button></div></section><aside class="stack"><section class="panel"><div class="panel-header"><h2>Los fotógrafos</h2><span>▣</span></div>${g.status === 'idle' ? '<p class="small muted">Se eligen al iniciar el juego.</p>' : state.teams.map(t => `<div class="photographer"><label>${symbols[t.id]} ${t.name}<select data-photographer="${t.id}" aria-label="Fotógrafo de ${t.name}">${state.participants.filter(x => x.team === t.id).map(x => `<option value="${x.id}" ${g.photographers[t.id] === x.id ? 'selected' : ''}>${esc(x.name)}${x.online ? ' · en línea' : ' · sin conexión'}</option>`).join('')}</select></label></div>`).join('')}<p class="form-note" style="margin-top:12px">Podés reemplazar al fotógrafo si se desconecta o no puede usar la cámara.</p></section><section class="panel"><p class="eyebrow">Para la consigna 03</p><h3 style="margin:10px 0">La pose a copiar</h3><p class="small muted">Cargá la referencia antes de lanzar la tercera consigna.</p>${g.reference ? `<img class="reference" src="${g.reference}?role=admin" alt="Pose de referencia">` : ''}${g.prompts[2].status === 'idle' ? '<button class="btn light full" style="margin-top:16px" data-action="reference">↑ Cargar referencia</button>' : ''}</section><button class="btn light" data-action="navigate" data-game="4">Ver resultados finales →</button></aside></div>`;
}
function results() {
  const ordered = [...state.teams].sort((a, b) => state.totals[b.id] - state.totals[a.id]);
  const winners = ordered.filter(t => state.totals[t.id] === state.totals[ordered[0].id]);
  return `<section class="panel"><div class="results-hero"><span class="trophy" aria-hidden="true">♛</span><p class="eyebrow" style="margin-top:15px">La fiesta es de todos</p><h2>${winners.length > 1 ? '¡Hay empate en la cima!' : `¡Vamos, ${winners[0].name.toLowerCase()}!`}</h2><p>${winners.length > 1 ? winners.map(t => t.name).join(' + ') : 'Una gran salita. Un montón de buenos recuerdos.'}</p></div>${ordered.map(t => { const rank = 1 + ordered.filter(x => state.totals[x.id] > state.totals[t.id]).length; return `<div class="winner-card ${t.id}"><div><span class="place">${rank}º</span><strong>${symbols[t.id]} ${t.name}</strong></div><div class="points">${state.totals[t.id]} <small>pts</small></div></div>`; }).join('')}<div class="game-results"><h3>Cada punto cuenta</h3><div class="table-scroll"><table class="leaderboard"><thead><tr><th>Equipo</th><th>Animal</th><th>Color</th><th>Fotos</th><th>Total</th></tr></thead><tbody>${ordered.map(t => `<tr><td>${t.name}</td>${[1, 2, 3].map(id => `<td>${state.games[id].scores[t.id]}</td>`).join('')}<td>${state.totals[t.id]}</td></tr>`).join('')}</tbody></table></div>${[1, 2, 3].map(id => `<p class="form-note" style="margin-top:12px"><strong>${names[id]}:</strong> ${state.games[id].status === 'idle' ? 'Todavía no se jugó.' : resultMessage(id)}</p>`).join('')}</div>${[1, 2, 3].some(id => state.games[id].status !== 'finished') ? '<p class="notice warning" style="margin-top:20px">Resultados parciales: todavía hay juegos sin terminar.</p>' : ''}</section>`;
}
function renderAdmin() {
  const selected = state.selectedGame;
  root.innerHTML = `<div class="dashboard"><aside class="sidebar">${brand}<p class="sidebar-label eyebrow">Tu fiesta, a tu ritmo</p><nav aria-label="Panel de juegos">${names.map((name, i) => `<button class="nav-button ${selected === i ? 'active' : ''}" data-action="navigate" data-game="${i}" ${selected === i ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${['◈', '♧', '◉', '▣', '♛'][i]}</span>${name}</button>`).join('')}</nav><div class="sidebar-bottom"><button class="nav-button" data-action="logout">Cerrar sesión</button><p>Un poquito de caos.<br>Mucho para festejar.</p></div></aside><main class="admin-main"><header class="page-heading"><div><p class="eyebrow">Panel del anfitrión</p><h1>Desafío Homer</h1><p>${selected === 0 ? 'Reuní a la banda. El resto lo hacemos jugando.' : names[selected]}</p></div><div class="stack" style="align-items:flex-end;gap:12px"><span class="pill"><span class="dot ${state.registrationOpen ? 'online' : 'live'}"></span>${state.registrationOpen ? 'Inscripciones abiertas' : 'Inscripciones cerradas'}</span></div></header><div class="row between status-line"><p class="eyebrow">${selected === 4 ? 'Marcador acumulado' : 'Así vienen las salitas'}</p>${connectionHtml()}</div>${scoreCards()}${selected === 0 ? adminLobby() : selected < 3 ? adminTimedGame(selected) : selected === 3 ? adminPhotos() : results()}<section class="panel" style="margin-top:24px"><div class="row between wrap"><div><h3>Empezar de cero</h3><p class="small muted" style="margin-top:6px">Borrá los participantes, equipos y todos los juegos de prueba.</p></div><button class="btn danger" data-action="reset-party">↺ Reiniciar toda la fiesta</button></div><p class="form-note" style="margin-top:12px">Se eliminan también puntos y fotos. Tu cuenta administrativa se conserva.</p></section>${footer}</main></div>`;
}
const animalPaths = {
  gato: 'M59 118 54 34 112 72Q160 52 208 72L266 34 261 118Q291 152 269 212Q248 261 160 264Q72 261 51 212Q29 152 59 118Z',
  perro: 'M85 81Q46 38 26 96L17 177Q19 210 57 192L75 158Q64 257 160 268Q256 257 245 158L263 192Q301 210 303 177L294 96Q274 38 235 81Q160 41 85 81Z',
  conejo: 'M103 113Q53 8 87 9Q123 9 138 103L182 103Q197 9 233 9Q267 8 217 113Q267 146 257 205Q247 266 160 272Q73 266 63 205Q53 146 103 113Z',
  oso: 'M73 100Q16 91 33 45Q60 11 98 57Q160 36 222 57Q260 11 287 45Q304 91 247 100Q282 136 272 200Q261 267 160 273Q59 267 48 200Q38 136 73 100Z',
  mariposa: 'M150 130Q87 22 35 49Q-3 75 28 150Q6 220 65 249Q107 267 150 210L170 210Q213 267 255 249Q314 220 292 150Q323 75 285 49Q233 22 170 130L170 82 150 82Z',
  pez: 'M264 109 315 67 309 220 263 190Q216 268 112 227Q77 209 36 162Q77 105 112 87Q216 46 264 109Z',
};
function animalSvg(animal, code) { return `<svg class="animal-silhouette" viewBox="0 0 330 290" role="img" aria-label="${esc(animal)}, tu código ${esc(code)}"><path fill="currentColor" d="${animalPaths[animal] || animalPaths.gato}"/><text x="165" y="181" text-anchor="middle">${esc(code)}</text></svg>`; }
function guestLobby() {
  const me = state.me;
  return `<div class="guest-welcome"><p class="eyebrow">Ya sos parte de la fiesta</p><h1>¡Llegaste, ${esc(me.name)}!</h1><p>${state.drawn ? 'Tu equipo está listo. Ahora empieza lo bueno.' : 'Ponete cómodo. Estamos esperando a la banda.'}</p></div>${state.drawn ? `<div class="team-reveal ${me.team}"><div class="big-symbol">${symbols[me.team]}</div><p>TE TOCÓ SER PARTE DE</p><h2>${teamName(me.team)}</h2><p>Buscá a tus compañeros. ¡Vamos por esos puntos!</p></div><section class="panel"><div class="panel-header"><h2>Tu salita</h2><span class="pill">${state.participants.filter(p => p.team === me.team).length} jugadores</span></div>${roster(state.participants.filter(p => p.team === me.team))}</section>` : `<section class="panel center"><div class="waiting-ring"><svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></div><h2>La previa también cuenta.</h2><p class="small muted" style="margin:15px 0">Cuando el anfitrión sortee los equipos,<br>tu salita va a aparecer acá.</p><span class="pill">${state.participants.length} invitados en la sala</span></section>`}<p class="notice" style="margin-top:20px">${state.drawn ? 'El anfitrión va a dar inicio al juego. Esta pantalla se actualiza sola.' : 'Podés recargar esta página: tu lugar queda guardado en este navegador.'}</p><div class="stack waiting-overview">${[1, 2, 3].map(waitingRules).join('')}</div>`;
}
function guestTimed(id) {
  const g = state.games[id], me = g.me;
  const head = `<div class="guest-game-head"><div><p class="eyebrow">Juego 0${id}</p><h1>${names[id]}</h1></div>${g.status === 'active' ? `<div class="timer" data-timer="${id}">${formatTime(remaining(id))}</div>` : '<span class="pill">2 minutos</span>'}</div>`;
  if (g.status === 'idle') return `${head}<section class="panel center"><div class="waiting-ring">${id === 1 ? '♧' : '◉'}</div><h2>En sus marcas…</h2><p class="small muted" style="margin:15px 0 25px">El anfitrión está por empezar la ronda.<br>¡Preparate para sumar!</p><h3 style="text-align:left;margin-bottom:16px">Cómo se juega</h3><ul class="rules" style="text-align:left">${gameRules(id)}</ul></section>`;
  if (g.status === 'finished') return `${head}<section class="panel center"><span class="empty-symbol">✦</span><h2>¡Tiempo!</h2><p class="small muted" style="margin-top:12px">${resultMessage(id)}</p></section>${scoreCards(id)}<p class="notice">Tus puntos ya están guardados. Esperá el próximo juego.</p>${waitingRules(id)}`;
  if (id === 1) return `${head}<p class="small muted">Buscá a alguien con el mismo animal e intercambien sus códigos.</p><div class="animal-card" style="margin-top:20px">${animalSvg(me.animal, me.code)}<p class="animal-label">${esc(me.animal)} · Este es tu código</p></div>${g.paused ? '<div class="notice warning" style="margin-bottom:16px">Falta un compañero conectado. Los intercambios se reanudan cuando vuelva alguien.</div>' : ''}<form id="exchange-form" class="stack" data-own-code="${me.code}"><label>El código de tu compañero<input class="code-entry" id="target-code" name="target" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" placeholder="0000" autocomplete="off" required data-preserve></label><button class="btn full" ${g.paused || !connected ? 'disabled' : ''}>Confirmar código ↗</button></form><p class="notice" style="margin-top:17px" role="status">${me.pending ? '✓ Código enviado. Esperando que tu compañero ingrese el tuyo.' : 'Los dos tienen que ingresar el código del otro para sumar.'}</p><p class="form-note center" style="margin-top:15px">Misma salita: +1 total · Otra salita: +2 para cada equipo</p>`;
  return `${head}<p class="small muted">Encontrá un objeto de este color. Acercalo a la cámara y llená el centro de la guía.</p><div class="color-swatch" style="background:${me.challenge.hex}"><span>${me.challenge.name}</span></div><button class="btn full" data-action="color-camera" ${!connected ? 'disabled' : ''}>▣ Abrir cámara</button><button class="btn light full" style="margin-top:12px" data-action="skip" ${me.skips >= 3 || !connected ? 'disabled' : ''}>Saltar color <span class="muted">· ${3 - me.skips} disponibles</span></button><p class="form-note center" style="margin-top:17px">Cada color encontrado suma 1 punto para ${teamName(state.me.team)}.</p>${scoreCards(2)}`;
}
function guestPhotos() {
  const g = state.games[3], p = g.prompts[g.current], photographer = g.photographers[state.me.team];
  const head = '<div class="guest-game-head"><div><p class="eyebrow">Juego 03</p><h1>Desafío de fotos</h1></div><span class="nav-icon">▣</span></div>';
  if (g.status === 'idle') return `${head}<div class="panel center"><div class="waiting-ring">▣</div><h2>Se viene la foto.</h2><p class="small muted" style="margin-top:15px">El anfitrión va a sortear un fotógrafo por salita. Todos participan; una persona captura el momento.</p></div>${waitingRules(3)}`;
  return `${head}<div class="notice">${photographer === state.me.id ? '<strong>¡Sos el fotógrafo de tu salita!</strong><br>Vos tenés la cámara. Tu equipo pone la actitud.' : `El fotógrafo de tu equipo es <strong>${esc(personName(photographer))}</strong>. Organizá la foto con tu salita.`}</div>${p ? `<section class="prompt-card"><p class="eyebrow">Consigna ${g.current + 1} de 5 · ${p.status === 'active' ? 'En juego' : 'Cerrada'}</p><h2>${esc(p.text)}</h2>${g.current === 2 && g.reference ? `<img class="reference" src="${g.reference}" alt="La pose que tiene que copiar tu equipo">` : ''}</section>${p.status === 'active' ? p.submissions[state.me.team] ? '<div class="notice">✓ ¡Foto entregada! El anfitrión la revisará al cerrar la consigna.</div>' : photographer === state.me.id ? '<button class="btn full" data-action="team-camera">▣ Preparar la foto del equipo</button><p class="form-note center" style="margin-top:12px">Podés revisarla antes de enviar. Hay una sola entrega final.</p>' : '<div class="notice">Ayudá a organizar la foto. Solo el fotógrafo puede enviarla.</div>' : `<div class="notice">${p.winner ? `Punto para ${teamName(p.winner)}.` : 'Consigna cerrada. El anfitrión está revisando las fotos.'}</div>`}` : '<div class="panel center" style="margin-top:20px"><div class="waiting-ring">✦</div><h2>El equipo está listo.</h2><p class="small muted" style="margin-top:12px">La primera consigna va a aparecer acá.</p></div>'}${scoreCards(3)}${waitingRules(3)}`;
}
function renderGuest() {
  root.innerHTML = `<main class="guest-shell"><header class="guest-header">${brand}<span class="pill">¡A jugar!</span></header><div class="row between"><span class="pill ${state.me.team || ''}">${state.me.team ? `${symbols[state.me.team]} ${teamName(state.me.team)}` : 'La previa'}</span>${connectionHtml()}</div>${!state.drawn || state.selectedGame === 0 ? guestLobby() : state.selectedGame < 3 ? guestTimed(state.selectedGame) : state.selectedGame === 3 ? guestPhotos() : `<div style="margin-top:25px">${results()}</div>`}${footer}</main>`;
}
function render() {
  // Preserve partially entered codes/alias selections when another player connects.
  const preserved = [...document.querySelectorAll('[data-preserve]')].map(el => ({ id: el.id, value: el.value, focused: el === document.activeElement, start: el.selectionStart }));
  const ownCode = $('#exchange-form')?.dataset.ownCode;
  isAdmin ? renderAdmin() : renderGuest();
  for (const p of preserved) {
    const el = document.getElementById(p.id);
    if (!el || (p.id === 'target-code' && ownCode !== $('#exchange-form')?.dataset.ownCode)) continue;
    el.value = p.value;
    if (p.focused) { el.focus({ preventScroll: true }); if (typeof el.setSelectionRange === 'function') el.setSelectionRange(p.start, p.start); }
  }
  const notice = state.games[1].me?.notice;
  if (notice && notice.id !== lastNotice) { lastNotice = notice.id; toast(notice.text); }
  if (review && modal.open) renderReview();
  if (camera && modal.open && !camera.sending && !cameraIsCurrent()) { closeModal(); toast('La ronda o el desafío cambió. Volvé a abrir la cámara.', true); }
}
function acceptState(next) {
  if (state && next.version < state.version) return;
  serverOffset = next.serverNow - Date.now(); state = next; render();
}
async function connectRoom() {
  const suffix = isAdmin ? '?role=admin' : '';
  acceptState(await api(`/api/rooms/${roomCode}/state${suffix}`));
  source?.close();
  source = new EventSource(`/api/rooms/${roomCode}/events${suffix}`);
  source.onmessage = event => { connected = true; acceptState(JSON.parse(event.data)); };
  source.addEventListener('reset', () => {
    source.close(); closeModal(); state = null; connected = false; lastNotice = null;
    landing(); toast('Homero reinició la fiesta. Ingresá tu nombre para volver a participar.');
  });
  source.onerror = () => { if (connected) { connected = false; render(); } };
}
async function refresh() {
  if (!state || document.hidden) return;
  try { acceptState(await api(`/api/rooms/${roomCode}/state${isAdmin ? '?role=admin' : ''}`)); }
  catch (error) {
    if (error.status === 401) { source?.close(); state = null; isAdmin ? login() : landing(); }
  }
}
async function adminAction(action, extra = {}) {
  await api(`/api/rooms/${roomCode}/admin/action`, { action, ...extra });
  await refresh();
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['join-form', 'login-form', 'create-room', 'exchange-form'].includes(form.id)) return;
  event.preventDefault(); if (loading) return; loading = true;
  const button = form.querySelector('button'); button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'join-form') {
      const code = roomCode || (await api('/api/party')).code;
      if (!code) throw new Error('Homero todavía está preparando la fiesta. Volvé en un ratito.');
      await api(`/api/rooms/${encodeURIComponent(code)}/join`, { name: data.name });
      location.href = '/';
    }
    if (form.id === 'login-form') { await api('/api/admin/login', data); location.href = roomCode ? `/admin/${roomCode}` : '/admin'; }
    if (form.id === 'create-room') { const result = await api('/api/admin/rooms', data); location.href = `/admin/${result.code}`; }
    if (form.id === 'exchange-form') {
      const result = await api(`/api/rooms/${roomCode}/exchange`, { ownCode: form.dataset.ownCode, targetCode: data.target });
      if (!result.confirmed) toast(result.message);
      await refresh();
    }
  } catch (error) { const errorBox = $('#form-error'); if (errorBox) errorBox.textContent = error.message; else toast(error.message, true); }
  finally { loading = false; button.disabled = false; }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action, id = Number(button.dataset.game);
  if (action === 'modal-close') return closeModal();
  if (action === 'capture') return captureFrame();
  if (action === 'camera-retry') return startCamera();
  if (action === 'camera-retake') return retake();
  if (action === 'photo-send') return sendPhoto();
  if (action === 'review-prev' || action === 'review-next') { review.position += action === 'review-prev' ? -1 : 1; return renderReview(); }
  if (loading) return;
  loading = true; button.disabled = true;
  try {
    if (action === 'logout') { await api('/api/admin/logout', {}); location.href = '/admin'; }
    if (action === 'copy') { await navigator.clipboard.writeText(`Desafío Homer · ¡Sumate a jugar! ${location.origin}/`); toast('¡Invitación copiada!'); }
    if (action === 'navigate') {
      const active = activeGame();
      const confirmed = !active || state.selectedGame === id || confirm('Hay una ronda activa. Cambiar de pantalla la cierra para todos y conserva los puntos ganados. ¿Continuar?');
      if (confirmed) await adminAction('navigate', { game: id, confirmed: true });
    }
    if (action === 'registration') await adminAction('registration', { open: button.dataset.open === 'true' });
    if (action === 'draw') { await adminAction('draw', { aliases: { azu: $('#alias-azu')?.value, juani: $('#alias-juani')?.value } }); toast('¡Las salitas están listas!'); }
    if (action === 'start') await adminAction('start', { game: id });
    if (action === 'close' && confirm(id === 3 ? '¿Cerrar esta consigna para todos? Los equipos que falten ya no podrán entregar.' : '¿Terminar la ronda ahora? Se conservan los puntos y se cierran los intentos pendientes.')) await adminAction('close', { game: id, runId: state.games[id].runId, index: state.games[3].current });
    if (action === 'reset' && confirm(`¿Reiniciar «${names[id]}»? Se borran sus puntos, progreso${id === 3 ? ', fotógrafos, entregas y foto de referencia' : ''}. Se conservan los equipos y los otros juegos.`)) await adminAction('reset', { game: id, confirmed: true, runId: state.games[id].runId });
    if (action === 'reset-party' && confirm('¿Reiniciar TODA la fiesta? Se cierran las rondas y se borran todos los participantes, equipos, puntos, fotos y la referencia. Los invitados deberán ingresar su nombre otra vez. Se conserva tu cuenta administrativa y se reabren las inscripciones. Esta acción no se puede deshacer.')) {
      await adminAction('reset-party', { confirmed: true, runId: state.games[1].runId });
      toast('Fiesta reiniciada. Ya podés empezar de cero.');
    }
    if (action === 'skip') await api(`/api/rooms/${roomCode}/skip`, { challengeId: state.games[2].me.challenge.id });
    if (action === 'prompt') await adminAction('prompt', { index: state.games[3].current + 1, runId: state.games[3].runId });
    if (action === 'reference') openCamera('reference');
    if (action === 'color-camera') openCamera('color');
    if (action === 'team-camera') openCamera('team');
    if (action === 'review') { review = { index: Number(button.dataset.index), position: 0 }; renderReview(); if (!modal.open) modal.showModal(); }
    if (action === 'award') { await adminAction('award', { index: review.index, winner: button.dataset.team || null, runId: state.games[3].runId }); toast('Adjudicación guardada. Totales actualizados.'); }
  } catch (error) { toast(error.message, true); }
  finally { loading = false; button.disabled = false; }
});
document.addEventListener('change', async event => {
  const input = event.target;
  if (input.dataset.photographer) {
    try { await adminAction('photographer', { team: input.dataset.photographer, playerId: input.value }); toast('Fotógrafo actualizado.'); }
    catch (error) { toast(error.message, true); render(); }
  }
  if (input.id === 'photo-file' && input.files[0]) {
    try { await prepareFile(input.files[0]); }
    catch { toast('No pudimos abrir esa imagen. Probá con JPG o con la cámara.', true); }
  }
});

function stopStream() {
  camera?.stream?.getTracks().forEach(track => track.stop());
  if (camera) { camera.stream = null; camera.generation = (camera.generation || 0) + 1; }
}
function closeModal() {
  stopStream(); if (camera?.url) URL.revokeObjectURL(camera.url);
  camera = null; review = null; modal.close(); modal.innerHTML = '';
}
modal.addEventListener('cancel', event => { event.preventDefault(); if (!camera?.sending) closeModal(); });
function cameraIsCurrent() {
  if (!camera || camera.kind === 'reference') return true;
  if (camera.kind === 'color') return state.games[2].status === 'active' && state.games[2].me.challenge.id === camera.challengeId;
  return state.games[3].runId === camera.runId && state.games[3].current === camera.index && state.games[3].prompts[camera.index]?.status === 'active' && state.games[3].photographers[state.me.team] === state.me.id && !state.games[3].prompts[camera.index].submissions[state.me.team];
}
function openCamera(kind) {
  camera = { kind, blob: null, stream: null, url: null, sending: false, challengeId: state.games[2].me?.challenge.id, index: state.games[3].current, runId: state.games[3].runId };
  renderCamera(); modal.showModal(); if (kind !== 'reference') startCamera();
}
function renderCamera(message = '') {
  const c = camera;
  modal.innerHTML = `<div class="modal-head"><h2>${c.kind === 'reference' ? 'La pose de referencia' : c.kind === 'color' ? `Buscá ${state.games[2].me.challenge.name.toLowerCase()}` : 'La foto de tu salita'}</h2><button class="icon-button" data-action="modal-close" aria-label="Cerrar cámara" ${c.sending ? 'disabled' : ''}>×</button></div><div class="camera-stage">${c.blob ? `<img src="${c.url}" alt="Vista previa de tu foto">` : `<video id="camera-video" autoplay muted playsinline></video><div class="camera-placeholder" id="camera-message">${esc(message || (c.kind === 'reference' ? 'Elegí la imagen que los equipos van a copiar.' : 'Preparando la cámara…'))}</div>`}${c.kind === 'color' ? '<div class="camera-guide" aria-hidden="true"></div>' : ''}</div><div class="error-inline" id="camera-error" role="alert"></div>${c.blob ? `<p class="form-note" style="margin-bottom:14px">${c.kind === 'team' ? 'Revisá la captura. Esta será la única entrega final de tu equipo para esta consigna.' : c.kind === 'reference' ? 'Los jugadores la verán durante la tercera consigna.' : 'El objeto debe ocupar una parte suficiente del centro de la imagen.'}</p><div class="row"><button class="btn light grow" data-action="camera-retake" ${c.sending ? 'disabled' : ''}>Volver a tomar</button><button class="btn grow" data-action="photo-send" ${c.sending ? 'disabled' : ''}>${c.sending ? 'Enviando…' : c.kind === 'reference' ? 'Guardar referencia' : 'Enviar foto ↗'}</button></div>` : `<div class="stack" style="gap:10px">${c.kind !== 'reference' ? '<button class="btn full" id="capture-button" data-action="capture" disabled>◉ Sacar foto</button><button class="btn light full" data-action="camera-retry">Reintentar cámara</button>' : ''}<label class="file-label">${c.kind === 'reference' ? '↑ Elegir foto de referencia' : '↗ Usar la cámara del teléfono o elegir captura'}<input id="photo-file" type="file" accept="image/*" ${c.kind === 'reference' ? '' : 'capture="environment"'}></label><p class="form-note">${c.kind === 'reference' ? 'JPG, PNG o WebP.' : 'Si no se abre, habilitá la cámara en los permisos del navegador y reintentá.'}</p></div>`}`;
}
async function startCamera() {
  if (!camera) return;
  const current = camera; stopStream(); const generation = camera.generation;
  if (camera.url) URL.revokeObjectURL(camera.url);
  camera.blob = null; camera.url = null; renderCamera();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara necesita HTTPS. Abrí la dirección segura de la sala o usá la cámara del teléfono con el botón de abajo.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
    if (camera !== current || camera.generation !== generation) { stream.getTracks().forEach(t => t.stop()); return; }
    camera.stream = stream; const video = $('#camera-video'); video.srcObject = stream;
    await video.play();
    if (camera !== current || camera.generation !== generation) return;
    $('#camera-message').classList.add('hidden'); $('#capture-button').disabled = false;
    alignCameraGuide();
  } catch (error) {
    if (camera !== current || camera.generation !== generation) return;
    $('#camera-message').textContent = error.name === 'NotAllowedError' ? 'No tenemos permiso para usar la cámara. Habilitalo en los ajustes del navegador y tocá Reintentar.' : error.name === 'NotFoundError' ? 'No encontramos una cámara. Podés elegir una captura con el botón de abajo.' : error.message;
  }
}
function alignCameraGuide() {
  const guide = modal.querySelector('.camera-guide'), media = modal.querySelector('.camera-stage img, .camera-stage video');
  if (!guide || !media) return;
  const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
  if (!width || !height) return;
  const stage = media.parentElement.getBoundingClientRect(), scale = Math.min(stage.width / width, stage.height / height);
  const drawnWidth = width * scale, drawnHeight = height * scale;
  Object.assign(guide.style, { width: `${drawnWidth * .7}px`, height: `${drawnHeight * .7}px`, left: `${(stage.width - drawnWidth) / 2 + drawnWidth * .15}px`, top: `${(stage.height - drawnHeight) / 2 + drawnHeight * .15}px` });
}
modal.addEventListener('load', alignCameraGuide, true);
window.addEventListener('resize', alignCameraGuide);
async function imageBlob(source, width, height) {
  const canvas = document.createElement('canvas'), factor = Math.min(1, 1280 / Math.max(width, height));
  canvas.width = Math.round(width * factor); canvas.height = Math.round(height * factor);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo preparar la foto.')), 'image/jpeg', .86));
}
async function captureFrame() {
  try {
    const current = camera, video = $('#camera-video');
    if (!video?.videoWidth) return toast('La cámara todavía está iniciando. Reintentá.', true);
    const blob = await imageBlob(video, video.videoWidth, video.videoHeight);
    if (camera !== current) return;
    stopStream(); camera.blob = blob; camera.url = URL.createObjectURL(blob); renderCamera();
  } catch (error) { toast(error.message, true); }
}
async function prepareFile(file) {
  const current = camera;
  if (file.size > 25 * 1024 * 1024) throw new Error('Imagen demasiado grande.');
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url; await img.decode();
    const blob = await imageBlob(img, img.naturalWidth, img.naturalHeight);
    if (camera !== current) return;
    stopStream(); if (camera.url) URL.revokeObjectURL(camera.url);
    camera.blob = blob; camera.url = URL.createObjectURL(blob); renderCamera();
  } finally { URL.revokeObjectURL(url); }
}
function retake() {
  if (!camera || camera.sending) return;
  if (camera.url) URL.revokeObjectURL(camera.url); camera.blob = null; camera.url = null;
  if (camera.kind === 'reference') renderCamera(); else startCamera();
}
async function sendPhoto() {
  if (!camera?.blob || camera.sending) return;
  if (!cameraIsCurrent()) { closeModal(); return toast('La ronda o el desafío cambió.', true); }
  const c = camera;
  if (c.kind === 'team' && !confirm('¿Enviar esta foto como entrega final de tu equipo? No se puede reemplazar.')) return;
  c.sending = true; renderCamera();
  try {
    const endpoint = c.kind === 'reference' ? 'admin/reference' : c.kind === 'color' ? 'color-photo' : 'team-photo';
    const result = await api(`/api/rooms/${roomCode}/${endpoint}`, c.blob, { 'X-Challenge-Id': c.challengeId || '', 'X-Prompt-Index': String(c.index), 'X-Run-Id': c.runId });
    if (result.accepted === false) { c.sending = false; renderCamera(); $('#camera-error').textContent = result.message; return; }
    closeModal(); toast(result.message || 'Referencia guardada.'); await refresh();
  } catch (error) {
    if (camera !== c) return;
    c.sending = false; renderCamera(); $('#camera-error').textContent = error.message;
  }
}
function renderReview() {
  const p = state.games[3].prompts[review.index];
  if (p.status !== 'closed') { closeModal(); return; }
  const photos = Object.entries(p.submissions);
  review.position = Math.max(0, Math.min(review.position, photos.length - 1));
  const current = photos[review.position];
  modal.innerHTML = `<div class="modal-head"><div><p class="eyebrow">Revisión · Consigna ${review.index + 1}</p><h2 style="margin-top:8px">Una foto a la vez.</h2></div><button class="icon-button" data-action="modal-close" aria-label="Cerrar revisión">×</button></div>${current ? `<img class="review-photo" src="${current[1].url}?role=admin" alt="Entrega de ${teamName(current[0])}"><div class="review-info"><h3>${esc(p.text)}</h3><p><strong>${teamName(current[0])}</strong> · ${esc(personName(current[1].playerId))}</p><p>Tiempo hasta el envío: <strong>${elapsed(current[1].elapsedMs)}</strong></p></div><div class="review-controls"><button class="btn light small" data-action="review-prev" ${review.position === 0 ? 'disabled' : ''}>← Anterior</button><span>${review.position + 1} de ${photos.length}</span><button class="btn light small" data-action="review-next" ${review.position === photos.length - 1 ? 'disabled' : ''}>Siguiente →</button></div>` : '<div class="empty">Ningún equipo entregó una foto.</div>'}<div class="divider"></div><h3>¿Quién se lleva el punto?</h3><p class="form-note" style="margin:10px 0 16px">Decidí si cumple la consigna y usá el tiempo hasta el envío como criterio. Podés corregir el ganador: el total se recalcula.</p><div class="award-buttons">${state.teams.filter(t => p.submissions[t.id]).map(t => `<button class="btn light small ${p.winner === t.id ? 'selected' : ''}" data-action="award" data-team="${t.id}">${symbols[t.id]} ${t.name}</button>`).join('')}<button class="btn light small ${p.winner === null ? 'selected' : ''}" data-action="award" data-team="">Sin ganador</button></div><p class="small muted" style="margin-top:15px">Guardado: ${p.winner ? `1 punto para ${teamName(p.winner)}` : 'sin ganador'}</p>`;
}

setInterval(() => {
  if (!state) return;
  document.querySelectorAll('[data-timer]').forEach(el => { const ms = remaining(Number(el.dataset.timer)); el.textContent = formatTime(ms); el.classList.toggle('expiring', ms <= 15000); });
}, 250);
setInterval(refresh, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopStream(); else refresh(); });
window.addEventListener('pagehide', () => { stopStream(); source?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted && state) connectRoom().catch(() => location.reload()); });
async function init() {
  try {
    if (isAdmin && !roomCode) return await roomList();
    if (!isAdmin && !roomCode) roomCode = (await api('/api/party')).code || '';
    if (roomCode) return await connectRoom();
    landing();
  } catch (error) {
    isAdmin ? login() : landing();
    if (error.status !== 401) toast(error.message, true);
  }
}
init();
