// Keyboard + mouse and twin-stick touch controls. Produces the input object
// the simulation expects. Buttons are edge-triggered and cleared by take().
const BUTTONS = [
  { id: 'reload', label: 'R', x: -70, y: -260 },
  { id: 'swap', label: '⇄', x: -150, y: -230 },
  { id: 'grenade', label: 'G', x: -225, y: -175 },
  { id: 'melee', label: '✊', x: -70, y: -340 },
  { id: 'pickup', label: '⬆', x: -150, y: -310 },
];

export class Input {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, used: false };
    this.edges = { reload: false, swap: false, pickup: false, grenade: false, melee: false };
    this.touch = 'ontouchstart' in window;
    this.left = null;    // { id, ox, oy, x, y }
    this.right = null;
    this.aim = 0;
    this.showScores = false;

    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) {
        if (k === 'r') this.edges.reload = true;
        if (k === 'q') this.edges.swap = true;
        if (k === 'e') this.edges.pickup = true;
        if (k === 'g') this.edges.grenade = true;
        if (k === 'f' || k === 'v') this.edges.melee = true;
      }
      if (k === 'tab') { this.showScores = true; e.preventDefault(); }
      this.keys.add(k);
    });
    addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.showScores = false;
    });
    canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.used = true; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.mouse.down = true; if (e.button === 2) this.edges.grenade = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('touchstart', e => this.onTouch(e, 'start'), { passive: false });
    canvas.addEventListener('touchmove', e => this.onTouch(e, 'move'), { passive: false });
    canvas.addEventListener('touchend', e => this.onTouch(e, 'end'), { passive: false });
    canvas.addEventListener('touchcancel', e => this.onTouch(e, 'end'), { passive: false });
  }

  buttonPos(b) {
    return [innerWidth + b.x, innerHeight + b.y];
  }

  onTouch(e, phase) {
    e.preventDefault();
    this.touch = true;
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        const hit = BUTTONS.find(b => {
          const [bx, by] = this.buttonPos(b);
          return Math.hypot(t.clientX - bx, t.clientY - by) < 34;
        });
        if (hit) { this.edges[hit.id] = true; continue; }
        if (t.clientX < innerWidth / 2 && !this.left) this.left = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        else if (t.clientX >= innerWidth / 2 && !this.right) this.right = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      } else {
        for (const s of ['left', 'right']) {
          const st = this[s];
          if (!st || st.id !== t.identifier) continue;
          if (phase === 'move') { st.x = t.clientX; st.y = t.clientY; } else this[s] = null;
        }
      }
    }
  }

  stick(st) {
    if (!st) return { x: 0, y: 0, mag: 0 };
    const dx = st.x - st.ox, dy = st.y - st.oy;
    const mag = Math.min(1, Math.hypot(dx, dy) / 60);
    const a = Math.atan2(dy, dx);
    return { x: Math.cos(a) * mag, y: Math.sin(a) * mag, mag, a };
  }

  // Current input for the local player at world position (px, py).
  take(px, py) {
    const k = this.keys;
    let mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let fly = k.has('w') || k.has('arrowup') || k.has(' ');
    let fire = this.mouse.down;
    if (this.mouse.used && px !== undefined) {
      const [wx, wy] = this.renderer.screenToWorld(this.mouse.x, this.mouse.y);
      this.aim = Math.atan2(wy - (py - 4), wx - px);
    }
    const L = this.stick(this.left), R = this.stick(this.right);
    if (this.left) {
      mx = Math.abs(L.x) > 0.25 ? L.x : 0;
      fly = L.y < -0.35;
    }
    if (this.right && R.mag > 0.2) {
      this.aim = R.a;
      fire = R.mag > 0.75;   // push the aim stick to the edge to shoot
    }
    const out = { mx, fly, aim: this.aim, fire, ...this.edges };
    this.edges = { reload: false, swap: false, pickup: false, grenade: false, melee: false };
    return out;
  }

  drawTouch(ctx, dpr) {
    if (!this.touch) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    for (const st of [this.left, this.right]) {
      if (!st) continue;
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff55';
      ctx.beginPath();
      const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), m = Math.min(d, 60) / (d || 1);
      ctx.arc(st.ox + dx * m, st.oy + dy * m, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of BUTTONS) {
      const [x, y] = this.buttonPos(b);
      ctx.fillStyle = '#00000055';
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(b.label, x, y + 1);
    }
    if (!this.left && !this.right) {
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#ffffff88';
      ctx.fillText('left thumb: move / push up to fly', innerWidth * 0.25, innerHeight - 30);
      ctx.fillText('right thumb: aim / push to edge to shoot', innerWidth * 0.62, innerHeight - 30);
    }
    ctx.restore();
  }
}
