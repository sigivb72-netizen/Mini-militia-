// Simple bot brain: chase the nearest enemy, jetpack over obstacles, avoid
// falling into the void, grab a better gun when one is close, shoot on sight.
import { rayCast, hasLineOfSight } from './geom.js';
import { WEAPONS } from './weapons.js';

// aim: miss distance in pixels at the target; react: seconds from first
// seeing someone to shooting; burst/pause: trigger on/off seconds; nade:
// seconds between grenades.
const SKILL = {
  easy:   { aim: 240, react: 1.2,  burst: 0.4, pause: 1.3, nade: [20, 30], melee: 0.3 },
  normal: { aim: 110, react: 0.5,  burst: 0.9, pause: 0.6, nade: [9, 15],  melee: 0.7 },
  hard:   { aim: 70,  react: 0.15, burst: 99,  pause: 0,   nade: [6, 12],  melee: 1 },
};

export function botInput(sim, p, dt) {
  const skill = SKILL[sim.settings.botSkill] || SKILL.easy;
  const inp = { mx: 0, fly: false, aim: p.aim || 0, fire: false, reload: false, swap: false, pickup: false, grenade: false, melee: false };
  if (!p.alive) return inp;
  const brain = p.brain || (p.brain = { aimErr: 0, retarget: 0, target: null, wander: Math.random() < 0.5 ? -1 : 1, nade: 5 + Math.random() * 5 });

  brain.retarget -= dt;
  if (brain.retarget <= 0 || !brain.target || !brain.target.alive) {
    brain.retarget = 0.6;
    let best = null, bestD = Infinity;
    for (const o of sim.players.values()) {
      if (!o.alive || !sim.isEnemy(p, o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y) * (hasLineOfSight(p.x, p.y, o.x, o.y, sim.edges) ? 0.5 : 1);
      if (d < bestD) { bestD = d; best = o; }
    }
    brain.target = best;
    brain.aimErr = (Math.random() - 0.5) * skill.aim;
  }

  // Where to go: a nearby better weapon if we only have a pistol, else the target.
  let gx = brain.target ? brain.target.x : p.x + brain.wander * 300;
  let gy = brain.target ? brain.target.y : p.y;
  if (!p.weapons[1]) {
    for (const pk of sim.pickups) {
      if (pk.timer > 0 || pk.w === 'medkit') continue;
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < 500) { gx = pk.x; gy = pk.y; break; }
    }
  }

  // Stuck behind terrain with no line of sight: wander a while to find a way round.
  brain.stuckT = (brain.stuckT || 0) + dt;
  if (brain.stuckT > 1.5) {
    const moved = brain.lastX === undefined ? 999 : Math.hypot(p.x - brain.lastX, p.y - brain.lastY);
    const seen = brain.target && hasLineOfSight(p.x, p.y, brain.target.x, brain.target.y, sim.edges);
    if (moved < 60 && !seen) { brain.roam = 2.5; brain.wander = Math.random() < 0.5 ? -1 : 1; brain.roamUp = Math.random() < 0.5; }
    brain.lastX = p.x; brain.lastY = p.y; brain.stuckT = 0;
  }
  brain.roam = (brain.roam || 0) - dt;
  if (brain.roam > 0) { gx = p.x + brain.wander * 400; gy = p.y + (brain.roamUp ? -300 : 0); }

  const dx = gx - p.x, dy = gy - p.y;
  const visible = brain.target && hasLineOfSight(p.x, p.y - 4, brain.target.x, brain.target.y, sim.edges);
  const tdist = brain.target ? Math.hypot(brain.target.x - p.x, brain.target.y - p.y) : Infinity;
  // Keep some distance when fighting a visible target.
  if (!(visible && tdist < 220)) inp.mx = Math.abs(dx) > 30 ? Math.sign(dx) : 0;

  const dir = inp.mx || brain.wander;
  const wallAhead = rayCast(p.x, p.y, dir, 0, 60, sim.edges).edge;
  const groundBelow = rayCast(p.x, p.y, 0, 1, sim.map.h, sim.edges).edge;
  const groundAhead = rayCast(p.x + p.vx * 0.4, p.y, 0, 1, sim.map.h, sim.edges).edge;
  if (dy < -80 || wallAhead) inp.fly = true;
  // Over the void: hold altitude (fly while falling) instead of climbing.
  if (sim.map.voidBelow && (!groundBelow || !groundAhead) && p.vy > -60) inp.fly = true;
  // Out of fuel: land and recharge to a good tank before flying again.
  if (p.fuel < 0.05) brain.resting = true;
  else if (p.fuel > 0.7) brain.resting = false;
  if (brain.resting && groundBelow && !sim.settings.infiniteFuel) inp.fly = false;
  if (wallAhead && !brain.target) brain.wander = -brain.wander;

  // Flying into an overhang: back away sideways for a moment to get around it.
  brain.detour = (brain.detour || 0) - dt;
  if (inp.fly && (dy < -40 || wallAhead) && rayCast(p.x, p.y, 0, -1, 45, sim.edges).edge && brain.detour <= 0) {
    brain.detour = 1.3;
    brain.detourDir = -(inp.mx || brain.wander);
  }
  if (brain.detour > 0) { inp.mx = brain.detourDir; inp.fly = true; }

  // Reaction time: how long the target has been in sight.
  brain.seen = visible ? (brain.seen || 0) + dt : 0;
  // Trigger discipline: shoot in bursts with pauses between them.
  brain.burstT = (brain.burstT || 0) - dt;
  if (brain.burstT <= 0) {
    brain.shooting = !brain.shooting;
    brain.burstT = (brain.shooting ? skill.burst : skill.pause) * (0.7 + Math.random() * 0.6);
  }

  if (brain.target) {
    const t = brain.target;
    // Aim drifts around the target instead of locking on.
    const wobble = Math.sin(sim.time * 2.3 + p.id.length) * skill.aim * 0.35;
    inp.aim = Math.atan2(t.y - (p.y - 4), t.x - p.x) + (brain.aimErr + wobble) / Math.max(tdist, 60);
    const w = p.weapons[p.slot], stats = WEAPONS[w.id];
    const range = stats.projectile ? 1400 : stats.range;
    if (visible && tdist < range && brain.seen >= skill.react && (brain.shooting || skill.pause === 0)) inp.fire = true;
    if (w.mag === 0) inp.reload = true;
    if (p.weapons[1] && p.slot === 0) inp.swap = true;   // prefer the picked-up gun
    if (visible && tdist < 70 && Math.random() < skill.melee * dt * 4) inp.melee = true;
    brain.nade -= dt;
    if (visible && brain.seen >= skill.react && tdist > 250 && tdist < 700 && brain.nade <= 0) {
      inp.grenade = true;
      brain.nade = skill.nade[0] + Math.random() * (skill.nade[1] - skill.nade[0]);
    }
  }
  return inp;
}
