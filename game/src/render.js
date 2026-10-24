// Draws a snapshot with placeholder shapes. All art lives here, so swapping
// in real sprites later only touches this file.
import { WEAPONS } from './weapons.js';
import { PLAYER_R } from './sim.js';

const VIEW_H = 950, VIEW_H_ZOOM = 1450;
const PICKUP_COLORS = { pistol: '#ccc', smg: '#e0b84f', rifle: '#7fd16a', shotgun: '#e0884f', sniper: '#6ac7e0', rocket: '#e05252', medkit: '#ffffff' };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = [];       // tracers, explosions, blood
    this.feed = [];          // kill feed
    this.cam = { x: 0, y: 0, scale: 1 };
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.dpr = dpr;
  }

  addEvents(events, now, myId) {
    for (const e of events) {
      if (e.k === 'shot') this.effects.push({ ...e, until: now + (e.w === 'sniper' ? 0.25 : 0.07), start: now });
      else if (e.k === 'boom') this.effects.push({ ...e, until: now + 0.45, start: now });
      else if (e.k === 'hit') this.effects.push({ ...e, until: now + 0.3, start: now, me: e.id === myId });
      else if (e.k === 'melee') this.effects.push({ ...e, until: now + 0.15, start: now });
      else if (e.k === 'kill') {
        this.feed.push({ ...e, until: now + 5 });
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 200;
          this.effects.push({ k: 'gib', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 150, c: e.c, start: now, until: now + 1.2 });
        }
      }
    }
    if (this.feed.length > 5) this.feed.splice(0, this.feed.length - 5);
  }

  worldToScreen(x, y) {
    return [(x - this.cam.x) * this.cam.scale + this.canvas.width / 2, (y - this.cam.y) * this.cam.scale + this.canvas.height / 2];
  }

  screenToWorld(sx, sy) {
    return [(sx * this.dpr - this.canvas.width / 2) / this.cam.scale + this.cam.x,
            (sy * this.dpr - this.canvas.height / 2) / this.cam.scale + this.cam.y];
  }

  draw(snap, map, myId, now, hud) {
    const { ctx, canvas } = this;
    const me = snap.players.find(p => p.id === myId);
    const zoom = me && me.al && WEAPONS[me.w] && WEAPONS[me.w].zoom;
    const scale = canvas.height / (zoom ? VIEW_H_ZOOM : VIEW_H);
    const tx = me && me.al ? me.x : (this.cam.x || map.w / 2), ty = me && me.al ? me.y : (this.cam.y || map.h / 2);
    this.cam.x += (tx - this.cam.x) * 0.2;
    this.cam.y += (ty - this.cam.y) * 0.2;
    this.cam.scale += (scale - this.cam.scale) * 0.15;
    const halfW = canvas.width / 2 / this.cam.scale, halfH = canvas.height / 2 / this.cam.scale;
    this.cam.x = Math.max(halfW, Math.min(map.w - halfW, this.cam.x));
    this.cam.y = Math.max(halfH, Math.min(map.h - halfH + (map.voidBelow ? 200 : 0), this.cam.y));
    if (halfW * 2 > map.w) this.cam.x = map.w / 2;

    // Sky.
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, map.sky[0]);
    g.addColorStop(1, map.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(this.cam.scale, this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    // Terrain.
    ctx.fillStyle = map.ground;
    ctx.strokeStyle = map.edge;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    for (const pts of map.solids) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Pickups.
    map.pickups.forEach((pk, i) => {
      if (!snap.picks[i]) return;
      const bob = Math.sin(now * 3 + i) * 4;
      ctx.fillStyle = PICKUP_COLORS[pk.w];
      if (pk.w === 'medkit') {
        ctx.fillRect(pk.x - 14, pk.y - 14 + bob, 28, 28);
        ctx.fillStyle = '#d33';
        ctx.fillRect(pk.x - 3, pk.y - 10 + bob, 6, 20);
        ctx.fillRect(pk.x - 10, pk.y - 3 + bob, 20, 6);
      } else {
        ctx.save();
        ctx.translate(pk.x, pk.y + bob);
        ctx.fillRect(-WEAPONS[pk.w].len, -5, WEAPONS[pk.w].len * 2, 10);
        ctx.fillStyle = '#000a';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(WEAPONS[pk.w].name, 0, -12);
        ctx.restore();
      }
    });

    // Projectiles.
    for (const pr of snap.proj) {
      ctx.fillStyle = pr.k === 'rocket' ? '#ffb347' : '#2d4d2d';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.k === 'rocket' ? 7 : 8, 0, Math.PI * 2);
      ctx.fill();
      if (pr.k === 'grenade') { ctx.strokeStyle = '#9f9'; ctx.lineWidth = 2; ctx.stroke(); }
    }

    // Players.
    for (const p of snap.players) {
      if (!p.al) continue;
      this.drawSoldier(ctx, p, p.id === myId, now);
    }

    // Effects.
    this.effects = this.effects.filter(e => e.until > now);
    for (const e of this.effects) {
      const life = (now - e.start) / (e.until - e.start);
      if (e.k === 'shot') {
        ctx.strokeStyle = e.w === 'sniper' ? `rgba(180,240,255,${1 - life})` : `rgba(255,240,150,${1 - life})`;
        ctx.lineWidth = e.w === 'sniper' ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
      } else if (e.k === 'boom') {
        ctx.fillStyle = `rgba(255,${160 - life * 120},40,${0.8 * (1 - life)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (0.4 + life * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.k === 'hit') {
        ctx.fillStyle = `rgba(200,30,30,${1 - life})`;
        for (let i = 0; i < 4; i++) ctx.fillRect(e.x + Math.sin(i * 7 + e.start) * 14 * life, e.y - 6 + Math.cos(i * 5 + e.start) * 14 * life, 4, 4);
      } else if (e.k === 'melee') {
        ctx.strokeStyle = `rgba(255,255,255,${1 - life})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 45, e.a - 0.8, e.a + 0.8);
        ctx.stroke();
      } else if (e.k === 'gib') {
        const t = now - e.start;
        ctx.fillStyle = e.c;
        ctx.fillRect(e.x + e.vx * t, e.y + e.vy * t + 600 * t * t, 6, 6);
      }
    }
    ctx.restore();

    this.drawHud(snap, me, now, hud, map);
  }

  drawSoldier(ctx, p, isMe, now) {
    const facing = Math.cos(p.a) >= 0 ? 1 : -1;
    // Jetpack and flame.
    ctx.fillStyle = '#555';
    ctx.fillRect(p.x - facing * 22 - 6, p.y - 14, 12, 26);
    if (p.fl) {
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 80},40,0.9)`;
      ctx.beginPath();
      ctx.moveTo(p.x - facing * 22 - 6, p.y + 12);
      ctx.lineTo(p.x - facing * 22 + 6, p.y + 12);
      ctx.lineTo(p.x - facing * 22, p.y + 30 + Math.random() * 14);
      ctx.fill();
    }
    // Body and head.
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x, p.y + 4, PLAYER_R - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1d3b0';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 11, p.y - 28, 22, 7);   // helmet band
    // Gun.
    const len = (WEAPONS[p.w] || WEAPONS.pistol).len + 14;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = p.w === 'rocket' ? 9 : 5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x + Math.cos(p.a) * len, p.y - 4 + Math.sin(p.a) * len);
    ctx.stroke();
    // Name and health over other players.
    if (!isMe) {
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(p.n, p.x, p.y - 44);
      ctx.fillStyle = '#0008';
      ctx.fillRect(p.x - 20, p.y - 40, 40, 5);
      ctx.fillStyle = p.hp > 40 ? '#5cd65c' : '#e05252';
      ctx.fillRect(p.x - 20, p.y - 40, 40 * p.hp / 100, 5);
    }
  }

  drawHud(snap, me, now, hud, map) {
    const { ctx, canvas } = this;
    const u = this.dpr;
    ctx.save();
    ctx.scale(u, u);
    const W = canvas.width / u, H = canvas.height / u;
    ctx.font = 'bold 15px sans-serif';
    ctx.textBaseline = 'top';

    if (me && me.al) {
      bar(ctx, 14, 14, 180, 14, me.hp / 100, me.hp > 40 ? '#5cd65c' : '#e05252');
      bar(ctx, 14, 32, 180, 10, me.f, '#4fb3e0');
      const w = WEAPONS[me.w];
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      const ammo = hud.infiniteAmmo ? '∞' : `${me.m} / ${me.rs}`;
      ctx.fillText(`${w.name}  ${me.rl ? 'reloading…' : ammo}`, 14, 48);
      ctx.fillStyle = '#ddd';
      ctx.fillText(`${me.o ? 'Other: ' + WEAPONS[me.o].name + '   ' : ''}Grenades: ${hud.infiniteAmmo ? '∞' : me.g}`, 14, 68);
    } else if (me && !me.al && !snap.over) {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(`Respawning in ${Math.max(0, me.rt).toFixed(1)}`, W / 2, H / 2 - 20);
    }

    // Kill feed.
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px sans-serif';
    this.feed = this.feed.filter(f => f.until > now);
    this.feed.forEach((f, i) => {
      const text = f.a ? `${f.a}  [${f.w}${f.hs ? ' HEADSHOT' : ''}]  ${f.v}` : `${f.v} died`;
      ctx.fillStyle = '#0007';
      const tw = ctx.measureText(text).width;
      ctx.fillRect(W - tw - 22, 54 + i * 22, tw + 12, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, W - 16, 57 + i * 22);
    });

    // Score line.
    const sorted = [...snap.players].sort((a, b) => b.k - a.k);
    ctx.textAlign = 'right';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#fff';
    if (hud.mode === 'tdm') {
      const s = [0, 0];
      snap.players.forEach(p => { s[p.tm] += p.k; });
      ctx.fillText(`Red ${s[0]}  :  ${s[1]} Blue   (to ${hud.killLimit})`, W - 16, 14);
    } else if (sorted[0]) {
      ctx.fillText(`Leader: ${sorted[0].n} ${sorted[0].k}/${hud.killLimit}`, W - 16, 14);
    }
    if (hud.roomCode) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffffcc';
      ctx.fillText(`Room ${hud.roomCode}`, W / 2, 14);
    }

    if (hud.showScores || snap.over) this.drawScoreboard(ctx, sorted, W, H, snap.over, hud);
    ctx.restore();
  }

  drawScoreboard(ctx, sorted, W, H, over, hud) {
    const rows = sorted.length;
    const bw = Math.min(420, W - 40), bh = 70 + rows * 26;
    const x = (W - bw) / 2, y = Math.max(60, (H - bh) / 2);
    ctx.fillStyle = '#000c';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(over ? `${over.w} wins!  Next match in ${Math.ceil(over.t)}` : 'Scores', W / 2, y + 12);
    ctx.font = '15px sans-serif';
    sorted.forEach((p, i) => {
      const ry = y + 48 + i * 26;
      ctx.fillStyle = p.c;
      ctx.fillRect(x + 16, ry + 2, 12, 12);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(`${p.n}${p.bot ? ' (bot)' : ''}`, x + 36, ry);
      ctx.textAlign = 'right';
      ctx.fillText(`${p.k} kills   ${p.d} deaths`, x + bw - 16, ry);
    });
  }
}

function bar(ctx, x, y, w, h, v, color) {
  ctx.fillStyle = '#0009';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * Math.min(1, v)), h - 4);
}
