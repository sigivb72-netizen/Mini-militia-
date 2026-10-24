// Authoritative game simulation. Runs on the host (or offline) and produces
// snapshots that every screen renders from.
import { buildEdges, collideCircle, rayCast, rayCircle, hasLineOfSight } from './geom.js';
import { WEAPONS, GRENADE, MELEE, MEDKIT_HEAL } from './weapons.js';
import { botInput } from './bots.js';

export const PLAYER_R = 20;
const GRAVITY = 1500, JET = 2900, MAX_FALL = 900, MAX_RISE = -520;
const RUN = 290, GROUND_ACC = 2600, AIR_ACC = 1300;
const FUEL_DRAIN = 0.42, FUEL_REGEN_GROUND = 0.35, FUEL_REGEN_AIR = 0.1;
const REGEN_DELAY = 4, REGEN_RATE = 15, RESPAWN = 3, PICKUP_RANGE = 45, PICKUP_RESPAWN = 15;
const TEAM_COLORS = ['#e05252', '#4f8fe0'];
const FFA_COLORS = ['#e05252', '#4f8fe0', '#5cc46a', '#e0b84f', '#b05ce0', '#4fd6d6', '#e07fb7', '#f0f0f0'];

export const EMPTY_INPUT = { mx: 0, fly: false, aim: 0, fire: false, reload: false, swap: false, pickup: false, grenade: false, melee: false };

export class Sim {
  constructor(map, settings) {
    this.map = map;
    this.settings = settings;   // { mode: 'ffa'|'tdm', killLimit, infiniteAmmo, infiniteFuel }
    this.edges = buildEdges(map.solids);
    this.players = new Map();
    this.projectiles = [];
    this.pickups = map.pickups.map(p => ({ ...p, timer: 0 }));
    this.events = [];
    this.time = 0;
    this.over = null;
    this.nextColor = 0;
  }

  addPlayer(id, name, isBot = false) {
    let team = -1;
    if (this.settings.mode === 'tdm') {
      const counts = [0, 0];
      for (const p of this.players.values()) counts[p.team]++;
      team = counts[0] <= counts[1] ? 0 : 1;
    }
    const color = team >= 0 ? TEAM_COLORS[team] : FFA_COLORS[this.nextColor++ % FFA_COLORS.length];
    const p = { id, name: String(name).slice(0, 14) || 'Player', isBot, team, color,
      kills: 0, deaths: 0, input: { ...EMPTY_INPUT }, alive: false, respawn: 0.5 };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    // Buttons are edge-triggered: keep a press until the next step consumes it.
    const prev = p.input;
    p.input = { ...input,
      reload: input.reload || prev.reload, swap: input.swap || prev.swap, pickup: input.pickup || prev.pickup,
      grenade: input.grenade || prev.grenade, melee: input.melee || prev.melee };
  }

  isEnemy(a, b) { return a !== b && (a.team < 0 || a.team !== b.team); }

  spawn(p) {
    const enemies = [...this.players.values()].filter(o => o.alive && this.isEnemy(p, o));
    let best = this.map.spawns[0], bestScore = -1;
    for (const s of this.map.spawns) {
      let d = 1e9;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.x - s[0], e.y - s[1]));
      const score = d + Math.random() * 300;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    Object.assign(p, { x: best[0], y: best[1], vx: 0, vy: 0, hp: 100, fuel: 1, alive: true,
      aim: best[0] < this.map.w / 2 ? 0 : Math.PI, grounded: false, flying: false,
      weapons: [this.makeWeapon('pistol'), null], slot: 0, cooldown: 0, reloadT: 0,
      grenades: GRENADE.perLife, meleeT: 0, lastHurt: -99, lastAttacker: null });
  }

  makeWeapon(id) {
    const w = WEAPONS[id];
    return { id, mag: w.mag, reserve: w.reserve };
  }

  step(dt) {
    this.time += dt;
    if (this.over) {
      this.over.t -= dt;
      if (this.over.t <= 0) this.restart();
      return;
    }
    for (const p of this.players.values()) {
      if (p.isBot) p.input = botInput(this, p, dt);
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.spawn(p);
        continue;
      }
      this.stepPlayer(p, dt);
    }
    this.stepProjectiles(dt);
    this.stepPickups(dt);
  }

  stepPlayer(p, dt) {
    const inp = p.input, s = this.settings;
    p.aim = inp.aim;

    // Movement and jetpack.
    const target = Math.max(-1, Math.min(1, inp.mx)) * RUN;
    const acc = p.grounded ? GROUND_ACC : AIR_ACC;
    p.vx += Math.max(-acc * dt, Math.min(acc * dt, target - p.vx));
    p.flying = inp.fly && (p.fuel > 0 || s.infiniteFuel);
    p.vy += GRAVITY * dt;
    if (p.flying) {
      p.vy -= JET * dt;
      if (!s.infiniteFuel) p.fuel = Math.max(0, p.fuel - FUEL_DRAIN * dt);
    } else {
      p.fuel = Math.min(1, p.fuel + (p.grounded ? FUEL_REGEN_GROUND : FUEL_REGEN_AIR) * dt);
    }
    p.vy = Math.max(MAX_RISE, Math.min(MAX_FALL, p.vy));
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.grounded = collideCircle(p, PLAYER_R, this.edges) < -0.5;
    if (this.map.voidBelow && p.y > this.map.h + 150) {
      this.kill(p, p.lastAttacker && this.time - p.lastHurt < 5 ? this.players.get(p.lastAttacker) : null, 'fall');
      return;
    }
    if (p.y > this.map.h + 400) p.y = this.map.h - 100;   // safety net

    // Health regeneration.
    if (this.time - p.lastHurt > REGEN_DELAY) p.hp = Math.min(100, p.hp + REGEN_RATE * dt);

    // Weapons.
    p.cooldown -= dt;
    p.meleeT -= dt;
    const w = p.weapons[p.slot];
    const stats = WEAPONS[w.id];
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const need = stats.mag - w.mag;
        const take = s.infiniteAmmo ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (!s.infiniteAmmo) w.reserve -= take;
      }
    }
    if (inp.swap && p.weapons[1]) {
      p.slot = 1 - p.slot;
      p.reloadT = 0;
      p.cooldown = Math.max(p.cooldown, 0.25);
    }
    const cur = p.weapons[p.slot], curStats = WEAPONS[cur.id];
    if (inp.reload && p.reloadT <= 0 && cur.mag < curStats.mag && (cur.reserve > 0 || s.infiniteAmmo)) {
      p.reloadT = curStats.reload;
    }
    if (inp.fire && p.cooldown <= 0 && p.reloadT <= 0) {
      if (cur.mag > 0) {
        this.fire(p, cur, curStats);
        p.cooldown = 1 / curStats.rate;
        if (!s.infiniteAmmo) cur.mag--;
        if (cur.mag === 0 && (cur.reserve > 0 || s.infiniteAmmo)) p.reloadT = curStats.reload;
      } else if (cur.reserve > 0 || s.infiniteAmmo) {
        p.reloadT = curStats.reload;
      }
    }
    if (inp.grenade && (p.grenades > 0 || s.infiniteAmmo)) {
      if (!s.infiniteAmmo) p.grenades--;
      const dx = Math.cos(p.aim), dy = Math.sin(p.aim);
      this.projectiles.push({ kind: 'grenade', owner: p.id, x: p.x + dx * 24, y: p.y + dy * 24,
        vx: dx * GRENADE.speed + p.vx * 0.5, vy: dy * GRENADE.speed + p.vy * 0.5, t: GRENADE.fuse, bounce: 0.45 });
    }
    if (inp.melee && p.meleeT <= 0) {
      p.meleeT = MELEE.cooldown;
      this.events.push({ k: 'melee', x: p.x, y: p.y, a: p.aim });
      for (const o of this.players.values()) {
        if (!o.alive || !this.isEnemy(p, o)) continue;
        const dx = o.x - p.x, dy = o.y - p.y;
        const dist = Math.hypot(dx, dy);
        const facing = Math.cos(Math.atan2(dy, dx) - p.aim) > 0.3;
        if (dist < MELEE.range + PLAYER_R * 2 && facing) this.damage(o, MELEE.dmg, p, 'melee');
      }
    }
    if (inp.pickup) this.tryPickup(p, true);
    // Buttons consumed.
    p.input = { ...inp, reload: false, swap: false, pickup: false, grenade: false, melee: false };
  }

  fire(p, w, stats) {
    const cx = p.x, cy = p.y - 4;
    if (stats.projectile) {
      const dx = Math.cos(p.aim), dy = Math.sin(p.aim);
      this.projectiles.push({ kind: 'rocket', owner: p.id, x: cx + dx * 26, y: cy + dy * 26,
        vx: dx * 950, vy: dy * 950, t: 4 });
      this.events.push({ k: 'shot', w: w.id, x1: cx, y1: cy, x2: cx + dx * 30, y2: cy + dy * 30 });
      return;
    }
    for (let i = 0; i < stats.pellets; i++) {
      const a = p.aim + (Math.random() - 0.5) * 2 * stats.spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      const wall = rayCast(cx, cy, dx, dy, stats.range, this.edges).t;
      let hitT = wall, victim = null;
      for (const o of this.players.values()) {
        if (!o.alive || !this.isEnemy(p, o)) continue;
        const t = rayCircle(cx, cy, dx, dy, o.x, o.y, PLAYER_R + 2);
        if (t < hitT) { hitT = t; victim = o; }
      }
      const hx = cx + dx * hitT, hy = cy + dy * hitT;
      if (victim) {
        const head = hy < victim.y - PLAYER_R * 0.45;
        this.damage(victim, stats.dmg * (head ? 1.5 : 1), p, w.id, head);
      }
      this.events.push({ k: 'shot', w: w.id, x1: cx, y1: cy, x2: hx, y2: hy, hit: victim ? 1 : 0 });
    }
  }

  stepProjectiles(dt) {
    const keep = [];
    for (const pr of this.projectiles) {
      pr.t -= dt;
      if (pr.kind === 'grenade') pr.vy += GRAVITY * dt;
      const px = pr.x, py = pr.y;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      let explode = pr.t <= 0;
      if (pr.kind === 'rocket') {
        const dx = pr.x - px, dy = pr.y - py, len = Math.hypot(dx, dy);
        const wall = rayCast(px, py, dx / len, dy / len, len, this.edges);
        if (wall.edge) { pr.x = px + dx / len * (wall.t - 2); pr.y = py + dy / len * (wall.t - 2); explode = true; }
        const owner = this.players.get(pr.owner);
        for (const o of this.players.values()) {
          if (o.alive && (!owner || this.isEnemy(owner, o)) && Math.hypot(o.x - pr.x, o.y - pr.y) < PLAYER_R + 6) explode = true;
        }
      } else {
        collideCircle(pr, 6, this.edges);
        pr.vx *= 1 - 0.4 * dt;
      }
      if (pr.y > this.map.h + 300) continue;
      if (explode) {
        const stats = pr.kind === 'rocket' ? WEAPONS.rocket : GRENADE;
        this.explode(pr.x, pr.y, stats.radius, stats.dmg, pr.owner, pr.kind);
      } else {
        keep.push(pr);
      }
    }
    this.projectiles = keep;
  }

  explode(x, y, radius, dmg, ownerId, cause) {
    this.events.push({ k: 'boom', x, y, r: radius });
    const owner = this.players.get(ownerId);
    for (const o of this.players.values()) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d > radius + PLAYER_R || !hasLineOfSight(x, y, o.x, o.y, this.edges)) continue;
      const self = o === owner;
      if (owner && !self && !this.isEnemy(owner, o)) continue;
      const f = 1 - Math.max(0, d - PLAYER_R) / radius;
      const push = 700 * f / Math.max(d, 1);
      o.vx += (o.x - x) * push;
      o.vy += (o.y - y) * push - 150 * f;
      this.damage(o, dmg * f * (self ? 0.5 : 1), owner, cause);
    }
  }

  damage(victim, amount, attacker, cause, head = false) {
    if (!victim.alive || amount <= 0) return;
    victim.hp -= amount;
    victim.lastHurt = this.time;
    if (attacker && attacker !== victim) victim.lastAttacker = attacker.id;
    this.events.push({ k: 'hit', x: victim.x, y: victim.y, id: victim.id });
    if (victim.hp <= 0) this.kill(victim, attacker, cause, head);
  }

  kill(victim, attacker, cause, head = false) {
    victim.alive = false;
    victim.hp = 0;
    victim.respawn = RESPAWN;
    victim.deaths++;
    const credited = attacker && attacker !== victim ? attacker : null;
    if (credited) credited.kills++;
    else victim.kills = Math.max(0, victim.kills - 1);   // suicide / fall
    this.events.push({ k: 'kill', a: credited ? credited.name : '', v: victim.name, w: cause, hs: head ? 1 : 0,
      x: victim.x, y: victim.y, c: victim.color });
    this.checkWin();
  }

  checkWin() {
    const limit = this.settings.killLimit;
    if (this.settings.mode === 'tdm') {
      const score = [0, 0];
      for (const p of this.players.values()) score[p.team] += p.kills;
      if (score[0] >= limit || score[1] >= limit) {
        this.over = { winner: score[0] >= limit ? 'Red team' : 'Blue team', t: 7 };
      }
    } else {
      for (const p of this.players.values()) {
        if (p.kills >= limit) { this.over = { winner: p.name, t: 7 }; break; }
      }
    }
  }

  restart() {
    this.over = null;
    this.projectiles = [];
    this.pickups.forEach(pk => { pk.timer = 0; });
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.alive = false; p.respawn = 0.5;
    }
  }

  tryPickup(p, pressed) {
    for (const pk of this.pickups) {
      if (pk.timer > 0 || Math.hypot(pk.x - p.x, pk.y - p.y) > PICKUP_RANGE) continue;
      if (pk.w === 'medkit') {
        if (p.hp >= 100) continue;
        p.hp = Math.min(100, p.hp + MEDKIT_HEAL);
      } else if (p.weapons.some(w => w && w.id === pk.w)) {
        const own = p.weapons.find(w => w && w.id === pk.w);
        if (own.reserve >= WEAPONS[pk.w].reserve) continue;
        own.reserve = WEAPONS[pk.w].reserve;   // refill ammo
      } else if (!p.weapons[1]) {
        p.weapons[1] = this.makeWeapon(pk.w);
        p.slot = 1;
        p.reloadT = 0;
      } else if (pressed) {
        p.weapons[p.slot] = this.makeWeapon(pk.w);
        p.reloadT = 0;
      } else {
        continue;
      }
      pk.timer = PICKUP_RESPAWN;
      this.events.push({ k: 'pick', x: pk.x, y: pk.y, id: p.id, w: pk.w });
      return;
    }
  }

  stepPickups(dt) {
    for (const pk of this.pickups) if (pk.timer > 0) pk.timer -= dt;
    for (const p of this.players.values()) if (p.alive) this.tryPickup(p, false);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Compact state for rendering and network transfer.
  snapshot() {
    const r = Math.round;
    const players = [];
    for (const p of this.players.values()) {
      const base = { id: p.id, n: p.name, c: p.color, tm: p.team, k: p.kills, d: p.deaths, al: p.alive ? 1 : 0, bot: p.isBot ? 1 : 0 };
      if (p.alive) {
        const w = p.weapons[p.slot], o = p.weapons[1 - p.slot];
        Object.assign(base, { x: r(p.x), y: r(p.y), vx: r(p.vx), vy: r(p.vy), a: +p.aim.toFixed(3), hp: r(p.hp),
          f: +p.fuel.toFixed(2), fl: p.flying ? 1 : 0, w: w.id, m: w.mag, rs: w.reserve,
          o: o ? o.id : '', rl: p.reloadT > 0 ? 1 : 0, g: p.grenades });
      } else {
        base.rt = +p.respawn.toFixed(1);
      }
      players.push(base);
    }
    return {
      t: +this.time.toFixed(3),
      players,
      proj: this.projectiles.map(p => ({ k: p.kind, x: r(p.x), y: r(p.y) })),
      picks: this.pickups.map(p => (p.timer > 0 ? 0 : 1)),
      over: this.over ? { w: this.over.winner, t: +this.over.t.toFixed(1) } : null,
    };
  }
}
