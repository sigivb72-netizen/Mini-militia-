import { MAPS } from './maps.js';
import { Sim, EMPTY_INPUT } from './sim.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Host, Client, makeRoomCode } from './net.js';
import { WEAPONS } from './weapons.js';

const STEP = 1 / 60, SEND_RATE = 1 / 20, INPUT_RATE = 1 / 30, INTERP_DELAY = 0.1;
const BOT_NAMES = ['Rook', 'Viper', 'Mako', 'Juno', 'Brick', 'Ghost', 'Nova', 'Tank'];

const $ = id => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);

let game = null;   // { kind: 'local'|'host'|'client', ... }
let scope = 1;     // local view zoom; each weapon caps it (4x close range, 7x long range)

// Scope button cycles 1x, 2x, ... up to the weapon's limit, then back to 1x.
function updateScope(pressed, weaponId) {
  const max = weaponId && WEAPONS[weaponId] ? WEAPONS[weaponId].scope : 1;
  if (pressed) scope = scope >= max ? 1 : scope + 1;
  if (scope > max) scope = max;
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}

function readSettings() {
  return {
    map: $('map').value,
    mode: $('mode').value,
    killLimit: Math.max(1, +$('kills').value || 20),
    bots: Math.max(0, Math.min(7, +$('bots').value || 0)),
    botSkill: $('botSkill').value,
    infiniteAmmo: $('ammo').checked,
    infiniteFuel: $('fuel').checked,
  };
}

function playerName() {
  const n = $('name').value.trim() || 'Player';
  store('mmx-name', n);
  return n;
}

function startLocalSim(settings, name) {
  const sim = new Sim(MAPS[settings.map], settings);
  sim.addPlayer('me', name);
  for (let i = 0; i < settings.bots; i++) sim.addPlayer('bot' + i, BOT_NAMES[i % BOT_NAMES.length], true);
  return sim;
}

function showGame(roomCode) {
  status('');
  $('menu').hidden = true;
  $('ingame').hidden = false;
  $('roomInfo').textContent = roomCode ? `Room code: ${roomCode}` : 'Offline match';
  $('invite').hidden = !roomCode;
}

function status(msg) { $('status').textContent = msg; }

// Offline vs bots.
$('playBots').onclick = () => {
  const settings = readSettings();
  game = { kind: 'local', sim: startLocalSim(settings, playerName()), settings, myId: 'me', acc: 0 };
  showGame(null);
};

// Host an online room: this device runs the match.
$('host').onclick = () => {
  const settings = readSettings();
  const code = makeRoomCode();
  const sim = startLocalSim(settings, playerName());
  status('Opening room…');
  const g = { kind: 'host', sim, settings, myId: 'me', acc: 0, sendAcc: 0, pending: [], code };
  g.net = new Host(code, {
    onOpen: () => { game = g; showGame(code); },
    onError: err => status('Could not open room: ' + (err.type || err)),
    onJoin: (id, name, conn) => {
      if (!sim.players.has(id)) sim.addPlayer(id, name);
      conn.send({ t: 'welcome', id, settings, code });
    },
    onInput: (id, i) => sim.setInput(id, i),
    onLeave: id => sim.removePlayer(id),
  });
};

// Join a friend's room.
$('join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length < 4) return status('Enter the room code');
  status('Connecting…');
  const g = { kind: 'client', snaps: [], myId: null, settings: null, inputAcc: 0, code };
  g.net = new Client(code, playerName(), {
    onError: err => status(err.type === 'peer-unavailable' ? 'Room not found' : 'Connection failed: ' + (err.type || err)),
    onClose: () => { alert('Disconnected from host'); location.reload(); },
    onMessage: msg => {
      if (msg.t === 'welcome') {
        g.myId = msg.id;
        g.settings = msg.settings;
        game = g;
        showGame(code);
      } else if (msg.t === 'snap') {
        g.snaps.push({ s: msg.s, at: performance.now() / 1000 });
        if (g.snaps.length > 30) g.snaps.shift();
        renderer.addEvents(msg.e, performance.now() / 1000, g.myId);
      }
    },
  });
};

$('leave').onclick = () => location.reload();
$('menuBtn').onclick = () => { $('pause').hidden = !$('pause').hidden; };
$('invite').onclick = async () => {
  if (window.NativeApp) {   // Android app: share the code through the system share sheet
    window.NativeApp.share(`Join my Jet Skirmish room: ${game.code}`);
    return;
  }
  const link = `${location.origin}${location.pathname}?room=${game.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Join my match', text: `Room ${game.code}`, url: link });
    else { await navigator.clipboard.writeText(link); $('invite').textContent = 'Link copied!'; }
  } catch { /* share cancelled */ }
};

// Interpolated snapshot for clients, rendered slightly in the past.
function clientSnapshot(g, now) {
  const snaps = g.snaps;
  if (!snaps.length) return null;
  const latest = snaps[snaps.length - 1];
  const serverNow = latest.s.t + (now - latest.at);
  const rt = serverNow - INTERP_DELAY;
  let a = snaps[0], b = latest;
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].s.t <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  }
  const span = b.s.t - a.s.t;
  const f = span > 0 ? Math.max(0, Math.min(1, (rt - a.s.t) / span)) : 1;
  const prev = new Map(a.s.players.map(p => [p.id, p]));
  const players = b.s.players.map(p => {
    const q = prev.get(p.id);
    if (p.id === g.myId) {
      // Own soldier: newest state and local aim, for a responsive feel.
      const own = latest.s.players.find(x => x.id === g.myId) || p;
      return own.al ? { ...own, a: input.aim } : own;
    }
    if (!q || !q.al || !p.al) return p;
    let da = p.a - q.a;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    return { ...p, x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f, a: q.a + da * f };
  });
  return { ...b.s, players, picks: latest.s.picks, over: latest.s.over };
}

let last = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - last);
  last = now;

  if (game) {
    let snap = null;
    if (game.kind === 'client') {
      game.inputAcc += dt;
      const meSnap = game.snaps.length && game.snaps[game.snaps.length - 1].s.players.find(p => p.id === game.myId);
      const inp = input.take(meSnap && meSnap.x, meSnap && meSnap.y);
      updateScope(inp.scope, meSnap && meSnap.al ? meSnap.w : null);
      game.pendingInput = merge(game.pendingInput, inp);
      if (game.inputAcc >= INPUT_RATE) {
        game.net.sendInput(game.pendingInput);
        game.pendingInput = null;
        game.inputAcc = 0;
      }
      snap = clientSnapshot(game, now);
    } else {
      const me = game.sim.players.get('me');
      const inp = me && me.alive ? input.take(me.x, me.y) : { ...EMPTY_INPUT, aim: input.take().aim };
      updateScope(inp.scope, me && me.alive ? me.weapons[me.slot].id : null);
      game.sim.setInput('me', inp);
      game.acc += dt;
      while (game.acc >= STEP) { game.sim.step(STEP); game.acc -= STEP; }
      const events = game.sim.drainEvents();
      renderer.addEvents(events, now, 'me');
      snap = game.sim.snapshot();
      if (game.kind === 'host') {
        game.pending.push(...events);
        game.sendAcc += dt;
        if (game.sendAcc >= SEND_RATE) {
          game.net.broadcast({ t: 'snap', s: snap, e: game.pending });
          game.pending = [];
          game.sendAcc = 0;
        }
      }
    }
    if (snap) {
      const s = game.settings;
      renderer.draw(snap, MAPS[s.map], game.myId, now, {
        infiniteAmmo: s.infiniteAmmo, mode: s.mode, killLimit: s.killLimit,
        roomCode: game.code, showScores: input.showScores, scope,
      });
      input.drawTouch(renderer.ctx, renderer.dpr);
    }
  }
  requestAnimationFrame(frame);
}

// Combine inputs between network sends so no button press is lost.
function merge(a, b) {
  if (!a) return b;
  return { ...b, reload: a.reload || b.reload, swap: a.swap || b.swap, pickup: a.pickup || b.pickup,
    grenade: a.grenade || b.grenade, melee: a.melee || b.melee, fire: a.fire || b.fire };
}

// Menu setup.
for (const [key, m] of Object.entries(MAPS)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = m.name;
  $('map').appendChild(o);
}
$('name').value = store('mmx-name') || '';
// Offline-only copies (e.g. hosts that block peer-to-peer) hide online rooms.
if (window.MMX_OFFLINE || typeof Peer === 'undefined') {
  $('host').hidden = true;
  document.querySelector('.join').hidden = true;
  status('Online rooms are off in this copy. Play vs bots.');
}
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) $('code').value = roomParam.toUpperCase();
requestAnimationFrame(frame);
