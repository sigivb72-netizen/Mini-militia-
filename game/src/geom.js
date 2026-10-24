// Map geometry: solid polygons turned into edges with outward normals,
// circle-vs-edge collision and ray casts.

export function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Edges of every solid polygon, each with a unit normal pointing out of the solid.
export function buildEdges(solids) {
  const edges = [];
  for (const pts of solids) {
    // In screen coordinates (y down) a positive area means clockwise.
    const cw = signedArea(pts) > 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Clockwise polygons: outward normal is (dy, -dx); counter-clockwise: (-dy, dx).
      const nx = (cw ? dy : -dy) / len, ny = (cw ? -dx : dx) / len;
      edges.push({ ax, ay, bx, by, dx, dy, len, nx, ny,
        minx: Math.min(ax, bx), maxx: Math.max(ax, bx), miny: Math.min(ay, by), maxy: Math.max(ay, by) });
    }
  }
  return edges;
}

// Push a circle out of all edges. Returns the most upward-facing contact
// normal's y (negative = standing on something), or 1 when untouched.
export function collideCircle(body, r, edges) {
  let groundNy = 1;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const e of edges) {
      if (body.x + r < e.minx || body.x - r > e.maxx || body.y + r < e.miny || body.y - r > e.maxy) continue;
      const t = ((body.x - e.ax) * e.dx + (body.y - e.ay) * e.dy) / (e.len * e.len);
      let nx, ny, depth;
      if (t > 0 && t < 1) {
        const d = (body.x - e.ax) * e.nx + (body.y - e.ay) * e.ny;
        if (d >= r || d <= -r) continue;
        nx = e.nx; ny = e.ny; depth = r - d;
      } else {
        const px = t <= 0 ? e.ax : e.bx, py = t <= 0 ? e.ay : e.by;
        const vx = body.x - px, vy = body.y - py;
        const dist = Math.hypot(vx, vy);
        if (dist >= r || dist < 1e-6) continue;
        // Only resolve corners from outside, otherwise the face test handles it.
        if (vx * e.nx + vy * e.ny < 0) continue;
        nx = vx / dist; ny = vy / dist; depth = r - dist;
      }
      body.x += nx * depth;
      body.y += ny * depth;
      const vn = body.vx * nx + body.vy * ny;
      if (vn < 0) {
        body.vx -= vn * nx * (1 + (body.bounce || 0));
        body.vy -= vn * ny * (1 + (body.bounce || 0));
      }
      if (ny < groundNy) groundNy = ny;
      moved = true;
    }
    if (!moved) break;
  }
  return groundNy;
}

// Nearest hit of the ray (x, y) + t * (dx, dy), t in [0, maxT], against edges.
export function rayCast(x, y, dx, dy, maxT, edges) {
  let best = maxT, hit = null;
  for (const e of edges) {
    const denom = dx * e.dy - dy * e.dx;
    if (Math.abs(denom) < 1e-9) continue;
    const ox = e.ax - x, oy = e.ay - y;
    const t = (ox * e.dy - oy * e.dx) / denom;
    const u = (ox * dy - oy * dx) / denom;
    if (t >= 0 && t < best && u >= 0 && u <= 1) { best = t; hit = e; }
  }
  return { t: best, edge: hit };
}

// Ray against circle; returns t or Infinity.
export function rayCircle(x, y, dx, dy, cx, cy, r) {
  const ox = x - cx, oy = y - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (c < 0 ? 0 : Infinity);
}

export function hasLineOfSight(x1, y1, x2, y2, edges) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  return rayCast(x1, y1, dx / len, dy / len, len, edges).t >= len - 0.5;
}
