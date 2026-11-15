import {
  type ArenaScene,
  type ArenaView,
  type TableSkinInfo,
  clamp,
  drawBox,
  floorY,
  makeCanvas,
  pathFloorQuad,
  pathSideQuad,
  pathWallRect,
  proj,
  radialGlow,
  rgba,
  rng,
  tableSpanPath,
  tableUV,
  vignette,
} from './engine';

interface Star {
  x: number;
  y: number;
  depth: number;
  size: number;
  tw: number;
  hue: number;
}

interface Mote {
  x: number;
  y: number;
  vy: number;
  vx: number;
  life: number;
}

/**
 * 🚀 STARSHIP BRIDGE — an orbital observation deck.
 * Panoramic viewport onto a ringed gas giant, glass floor panels over a blue planet,
 * holo-globe projector, radar table, chasing LED strips and periodic hyperspace jumps.
 */
export class StarshipScene implements ArenaScene {
  readonly id = 'starship';
  readonly tableLine: [number, number, number] = [90, 245, 255];

  private stars: Star[] = [];
  private motes: Mote[] = [];
  private planet: HTMLCanvasElement | null = null;
  private planetR = 0;

  paintTable(g: CanvasRenderingContext2D, info: TableSkinInfo) {
    const { w, h } = info;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a1a3f');
    grad.addColorStop(0.5, '#0b2357');
    grad.addColorStop(1, '#081536');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // Holographic perspective grid
    g.save();
    tableSpanPath(g, info);
    g.clip();
    g.strokeStyle = 'rgba(80, 200, 255, 0.22)';
    g.lineWidth = 1;
    for (let i = 1; i < 12; i++) {
      const u = i / 12;
      const a = tableUV(info, u, 0);
      const b = tableUV(info, u, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    for (let j = 1; j < 14; j++) {
      const vv = Math.pow(j / 14, 1.25);
      const a = tableUV(info, 0, vv);
      const b = tableUV(info, 1, vv);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    // Central reactor glow
    const c = tableUV(info, 0.5, 0.6);
    const rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, w * 0.38);
    rg.addColorStop(0, 'rgba(0, 220, 255, 0.35)');
    rg.addColorStop(1, 'rgba(0, 220, 255, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
    // Emblem ring
    g.strokeStyle = 'rgba(120, 230, 255, 0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(c.x, c.y, w * 0.14, h * 0.13, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  reset(v: ArenaView) {
    const r = rng(77);
    this.stars = [];
    const count = Math.round(clamp((v.W * v.H) / 2600, 160, 420));
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: r() * v.W,
        y: r() * v.H,
        depth: 0.2 + r() * 0.8,
        size: r() < 0.08 ? 2.2 : 0.6 + r() * 1.2,
        tw: r() * Math.PI * 2,
        hue: r(),
      });
    }
    this.motes = [];
    this.planet = null;
  }

  private buildPlanet(radius: number) {
    const size = Math.ceil(radius * 2.9);
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    if (!g) return;
    const cx = size / 2;
    const cy = size / 2;
    const r = rng(9);
    const tilt = -0.32;

    const ring = (front: boolean) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(tilt);
      for (let i = 0; i < 26; i++) {
        const rr = radius * (1.25 + i * 0.022);
        const alpha = 0.08 + r() * 0.22;
        g.strokeStyle = `rgba(${200 + Math.round(r() * 40)}, ${170 + Math.round(r() * 50)}, ${150 + Math.round(r() * 60)}, ${alpha})`;
        g.lineWidth = 1.6;
        g.beginPath();
        if (front) g.ellipse(0, 0, rr, rr * 0.22, 0, 0, Math.PI);
        else g.ellipse(0, 0, rr, rr * 0.22, 0, Math.PI, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    };

    ring(false);

    // Planet body with bands
    g.save();
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.clip();
    const base = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    base.addColorStop(0, '#f5b56a');
    base.addColorStop(0.5, '#c4624a');
    base.addColorStop(1, '#5a1f3d');
    g.fillStyle = base;
    g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    g.translate(cx, cy);
    g.rotate(tilt);
    for (let i = 0; i < 22; i++) {
      const y = -radius + (i / 22) * radius * 2 + (r() - 0.5) * 6;
      const hgt = 3 + r() * radius * 0.09;
      const cols = ['255,214,170', '180,80,70', '255,170,110', '120,50,80', '240,200,160'];
      g.fillStyle = `rgba(${cols[Math.floor(r() * cols.length)]}, ${0.18 + r() * 0.3})`;
      g.beginPath();
      g.ellipse(0, y, radius * 1.1, hgt, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Storm eye
    g.fillStyle = 'rgba(255, 120, 80, 0.55)';
    g.beginPath();
    g.ellipse(radius * 0.25, radius * 0.28, radius * 0.16, radius * 0.07, 0, 0, Math.PI * 2);
    g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Terminator shadow
    const sh = g.createRadialGradient(cx - radius * 0.45, cy - radius * 0.4, radius * 0.2, cx, cy, radius * 1.15);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(0.65, 'rgba(10,0,20,0.15)');
    sh.addColorStop(1, 'rgba(8,0,20,0.92)');
    g.fillStyle = sh;
    g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    g.restore();

    // Atmosphere rim
    const atm = g.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius * 1.12);
    atm.addColorStop(0, 'rgba(255,180,120,0)');
    atm.addColorStop(0.4, 'rgba(255,170,120,0.35)');
    atm.addColorStop(1, 'rgba(255,170,120,0)');
    g.fillStyle = atm;
    g.beginPath();
    g.arc(cx, cy, radius * 1.12, 0, Math.PI * 2);
    g.fill();

    ring(true);
    this.planet = c;
    this.planetR = radius;
  }

  private warpAmount(t: number): number {
    // A hyperspace jump every 26s, lasting ~2.6s
    const p = t % 26;
    if (p < 22.5 || p > 25.1) return 0;
    const k = (p - 22.5) / 2.6;
    return Math.sin(k * Math.PI);
  }

  drawBack(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, H, t } = v;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#030414');
    sky.addColorStop(0.45, '#070b26');
    sky.addColorStop(1, '#02030c');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Nebula clouds
    radialGlow(g, W * 0.22, v.jY * 0.35 + v.camY, W * 0.32, '140, 60, 220', 0.35);
    radialGlow(g, W * 0.48, v.jY * 0.15 + v.camY, W * 0.25, '0, 170, 255', 0.22);
    radialGlow(g, W * 0.8, H * 0.8, W * 0.35, '30, 90, 200', 0.25);

    const warp = this.warpAmount(t);
    // Star field drifting (ship cruising) + hyperspace streaks
    const drift = t * 14;
    g.lineCap = 'round';
    for (const s of this.stars) {
      const speed = s.depth * (1 + warp * 30);
      let x = (s.x - drift * s.depth) % W;
      if (x < 0) x += W;
      const y = s.y + v.camY * 0.5;
      const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + s.tw);
      const col = s.hue < 0.15 ? '255, 210, 170' : s.hue < 0.3 ? '170, 210, 255' : '235, 240, 255';
      if (warp > 0.02) {
        const len = warp * 140 * s.depth;
        g.strokeStyle = rgba(col, 0.35 + 0.6 * s.depth);
        g.lineWidth = s.size;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + len, y);
        g.stroke();
      } else {
        g.fillStyle = rgba(col, tw * (0.4 + 0.6 * s.depth));
        g.fillRect(x, y, s.size, s.size);
      }
      void speed;
    }

    // Ringed gas giant (cached) — slowly drifting
    const pr = Math.max(60, v.jY * 0.95);
    if (!this.planet || Math.abs(this.planetR - pr) > 4) this.buildPlanet(pr);
    if (this.planet) {
      const px = W * 0.7 - (t * 1.2) % 40 + Math.sin(t * 0.05) * 10;
      const py = v.jY * 0.42 + v.camY;
      g.drawImage(this.planet, px - this.planet.width / 2, py - this.planet.height / 2);
    }

    // Small moon
    const mx = W * 0.3 + Math.cos(t * 0.03) * 30;
    const my = v.jY * 0.3 + v.camY;
    const mr = Math.max(10, v.jY * 0.12);
    const mg = g.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, mr * 0.1, mx, my, mr);
    mg.addColorStop(0, '#d8e4ff');
    mg.addColorStop(1, '#3a4570');
    g.fillStyle = mg;
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();

    // Passing cruiser every ~14s
    const cyc = t % 14;
    if (cyc < 6) {
      const k = cyc / 6;
      const sx = -120 + k * (W + 240);
      const sy = v.jY * 0.62 + v.camY + Math.sin(k * 3) * 6;
      g.save();
      g.translate(sx, sy);
      g.fillStyle = '#1a2440';
      g.beginPath();
      g.moveTo(-46, 0);
      g.lineTo(30, -7);
      g.lineTo(52, 0);
      g.lineTo(30, 6);
      g.closePath();
      g.fill();
      g.fillStyle = '#2d3d66';
      g.fillRect(-20, -12, 26, 5);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = 'rgba(255, 230, 150, 0.9)';
        g.fillRect(-14 + i * 7, -2, 2, 2);
      }
      radialGlow(g, -50, 0, 22, '0, 200, 255', 0.9);
      g.restore();
    }

    // Blue planet far *below* the deck (seen through the glass floor panels)
    const bx = W * 0.5;
    const by = H * 1.55 + v.camY;
    const br = Math.max(W, H) * 0.95;
    const bg = g.createRadialGradient(bx, by - br * 0.2, br * 0.6, bx, by, br * 1.05);
    bg.addColorStop(0, '#0d4fb5');
    bg.addColorStop(0.85, '#0b2f7a');
    bg.addColorStop(0.94, 'rgba(90, 200, 255, 0.8)');
    bg.addColorStop(1, 'rgba(90, 200, 255, 0)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(bx, by, br * 1.05, 0, Math.PI * 2);
    g.fill();
    // Drifting cloud swirls on the planet below
    g.save();
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 9; i++) {
      const cx = ((i * 211 + t * 9) % (W + 300)) - 150;
      const cy = by - br + 40 + ((i * 97) % 220);
      g.fillStyle = 'rgba(230, 245, 255, 0.18)';
      g.beginPath();
      g.ellipse(cx, cy, 120 + (i % 3) * 40, 16 + (i % 2) * 8, 0.1, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  drawStatic(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, H, zWall, xWall } = v;
    const topY = -200;

    /* ---------- Back wall with panoramic viewport ---------- */
    const wallTop = proj(v, 0, 12, zWall).y;
    const bwL = proj(v, -xWall, 0, zWall).x;
    const bwR = proj(v, xWall, 0, zWall).x;
    const wallG = g.createLinearGradient(0, wallTop, 0, v.jY);
    wallG.addColorStop(0, '#1b2238');
    wallG.addColorStop(1, '#262f4a');
    g.fillStyle = wallG;
    g.fillRect(bwL, topY, bwR - bwL, v.jY - topY);

    // Viewport cut-out
    const winX = xWall * 0.86;
    const winY0 = 0.5;
    const a = proj(v, -winX, winY0, zWall);
    const b = proj(v, winX, winY0, zWall);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    const rr = 26;
    g.moveTo(a.x, topY);
    g.lineTo(a.x, a.y - rr);
    g.quadraticCurveTo(a.x, a.y, a.x + rr, a.y);
    g.lineTo(b.x - rr, b.y);
    g.quadraticCurveTo(b.x, b.y, b.x, b.y - rr);
    g.lineTo(b.x, topY);
    g.closePath();
    g.fill();
    g.restore();

    // Glass tint + reflection streaks
    g.fillStyle = 'rgba(60, 120, 255, 0.06)';
    g.fillRect(a.x, topY, b.x - a.x, a.y - topY);
    g.save();
    g.beginPath();
    g.rect(a.x, topY, b.x - a.x, a.y - topY);
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.045)';
    for (let i = 0; i < 4; i++) {
      const sx = a.x + (b.x - a.x) * (0.12 + i * 0.24);
      g.beginPath();
      g.moveTo(sx, topY);
      g.lineTo(sx + 60, topY);
      g.lineTo(sx - 30, a.y);
      g.lineTo(sx - 70, a.y);
      g.closePath();
      g.fill();
    }
    g.restore();

    // Mullions (thick struts)
    const struts = 5;
    for (let i = 0; i <= struts; i++) {
      const X = -winX + (i / struts) * winX * 2;
      const p = proj(v, X, winY0, zWall);
      const sw = i === 0 || i === struts ? 12 : 8;
      const sg = g.createLinearGradient(p.x - sw, 0, p.x + sw, 0);
      sg.addColorStop(0, '#0e1322');
      sg.addColorStop(0.5, '#4a5880');
      sg.addColorStop(1, '#0e1322');
      g.fillStyle = sg;
      g.fillRect(p.x - sw / 2, topY, sw, p.y - topY + 2);
    }
    // Sill
    g.fillStyle = '#39456a';
    g.fillRect(a.x - 12, a.y - 3, b.x - a.x + 24, 7);
    g.fillStyle = 'rgba(0, 240, 255, 0.85)';
    g.fillRect(a.x, a.y + 4, b.x - a.x, 2);

    // Lower wall panel seams + rivets
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      const p = proj(v, (i / 8) * xWall, 0, zWall);
      const q = proj(v, (i / 8) * xWall, winY0, zWall);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
      g.fillStyle = 'rgba(160, 180, 220, 0.4)';
      g.fillRect(q.x + 3, q.y + 4, 2, 2);
    }

    /* ---------- Side walls ---------- */
    for (const side of [-1, 1]) {
      const X = side * xWall;
      const sideG = g.createLinearGradient(side < 0 ? 0 : W, 0, side < 0 ? bwL : bwR, 0);
      sideG.addColorStop(0, '#0b0f1d');
      sideG.addColorStop(1, '#222a44');
      g.fillStyle = sideG;
      pathSideQuad(g, v, X, 0.9, zWall, 0, 14);
      g.fill();
      // Horizontal panel seams
      g.strokeStyle = 'rgba(120, 140, 200, 0.12)';
      for (const Y of [0.35, 1.2, 2.2, 3.4]) {
        const p0 = proj(v, X, Y, 0.9);
        const p1 = proj(v, X, Y, zWall);
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      }
      // Vertical ribs
      for (let z = 2; z < zWall; z += 1.4) {
        const p0 = proj(v, X, 0, z);
        const p1 = proj(v, X, 6, z);
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = Math.max(1, 6 * (v.f / z) / 120);
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      }
      g.lineWidth = 1;
      // Sliding door on each side wall
      g.fillStyle = '#141a2d';
      pathSideQuad(g, v, X, 5.2, 6.8, 0, 2.3);
      g.fill();
      g.strokeStyle = 'rgba(255, 190, 0, 0.55)';
      g.lineWidth = 2;
      pathSideQuad(g, v, X, 5.2, 6.8, 0, 2.3);
      g.stroke();
      const dm0 = proj(v, X, 0, 6.0);
      const dm1 = proj(v, X, 2.3, 6.0);
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.beginPath();
      g.moveTo(dm0.x, dm0.y);
      g.lineTo(dm1.x, dm1.y);
      g.stroke();
      g.lineWidth = 1;
    }

    /* ---------- Floor ---------- */
    const fl = g.createLinearGradient(0, v.jY, 0, H + 100);
    fl.addColorStop(0, '#151b2f');
    fl.addColorStop(1, '#0a0e1a');
    g.fillStyle = fl;
    pathFloorQuad(g, v, -xWall, xWall, 0.6, zWall);
    g.fill();

    // Deck plate grid
    g.strokeStyle = 'rgba(120, 150, 230, 0.13)';
    g.lineWidth = 1;
    for (let X = -Math.ceil(xWall); X <= xWall; X += 1) {
      const p0 = proj(v, X, 0, zWall);
      const p1 = proj(v, X, 0, 0.7);
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }
    for (let z = zWall; z > 0.8; z -= 0.9) {
      const y = floorY(v, z);
      const pl = proj(v, -xWall, 0, z);
      const pr = proj(v, xWall, 0, z);
      g.beginPath();
      g.moveTo(pl.x, y);
      g.lineTo(pr.x, y);
      g.stroke();
    }

    // Glass floor panels (cut out → planet below shows through)
    const glassX0 = 2.5;
    const glassX1 = xWall * 0.82;
    const panels: Array<[number, number]> = [];
    for (let z = 2.0; z < zWall - 1.0; z += 1.6) panels.push([z, z + 1.35]);
    for (const side of [-1, 1]) {
      for (const [z0, z1] of panels) {
        const x0 = side * glassX0;
        const x1 = side * glassX1;
        g.save();
        g.globalCompositeOperation = 'destination-out';
        pathFloorQuad(g, v, Math.min(x0, x1), Math.max(x0, x1), z0, z1);
        g.fill();
        g.restore();
        g.fillStyle = 'rgba(80, 160, 255, 0.08)';
        pathFloorQuad(g, v, Math.min(x0, x1), Math.max(x0, x1), z0, z1);
        g.fill();
        g.strokeStyle = 'rgba(70, 90, 140, 0.95)';
        g.lineWidth = 3;
        g.stroke();
        g.strokeStyle = 'rgba(0, 230, 255, 0.35)';
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // Sleek cyan LED runner tracks along the court sides
    for (const side of [-1, 1]) {
      const p0 = proj(v, side * 2.4, 0, zWall);
      const p1 = proj(v, side * 2.4, 0, 0.7);
      g.strokeStyle = 'rgba(0, 240, 255, 0.45)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    }

    // Floor emblem ring under the table
    const ec = proj(v, 0, 0, 3.6);
    g.strokeStyle = 'rgba(0, 220, 255, 0.35)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.ellipse(ec.x, ec.y, 1.8 * ec.s, 1.8 * ec.s * 0.33, 0, 0, Math.PI * 2);
    g.stroke();

    /* ---------- Consoles (Far Side Walls) ---------- */
    for (const side of [-1, 1]) {
      const x0 = side * xWall * 0.65;
      const x1 = side * xWall * 0.90;
      drawBox(g, v, Math.min(x0, x1), Math.max(x0, x1), 0, 0.85, 6.2, 7.4, '#2a3354', '#3a4672', '#1b2340');
      // Slanted screen bezel
      const s0 = proj(v, Math.min(x0, x1), 0.85, 6.2);
      const s1 = proj(v, Math.max(x0, x1), 0.85, 6.2);
      const s2 = proj(v, Math.max(x0, x1), 1.45, 7.0);
      const s3 = proj(v, Math.min(x0, x1), 1.45, 7.0);
      g.fillStyle = '#0d1122';
      g.beginPath();
      g.moveTo(s0.x, s0.y);
      g.lineTo(s1.x, s1.y);
      g.lineTo(s2.x, s2.y);
      g.lineTo(s3.x, s3.y);
      g.closePath();
      g.fill();
      // Button rows on console front
      for (let i = 0; i < 6; i++) {
        const bx = Math.min(x0, x1) + (Math.abs(x1 - x0) * (i + 0.5)) / 6;
        const bp = proj(v, bx, 0.6, 6.2);
        const cols = ['#ff3355', '#00f0ff', '#ffe600', '#00ff66'];
        g.fillStyle = cols[i % cols.length];
        g.fillRect(bp.x - 2, bp.y, 4, 3);
      }
    }

    vignette(g, v, '4, 6, 18', 0.55);
  }

  drawMid(g: CanvasRenderingContext2D, v: ArenaView) {
    const { t, xWall, zWall, dt } = v;

    // Chasing LED strips along side walls (floor level)
    for (const side of [-1, 1]) {
      const X = side * xWall;
      for (let z = 1.0; z < zWall; z += 0.35) {
        const p = proj(v, X, 0.12, z);
        const phase = (z * 2 - t * 6) % 6;
        const on = phase < 0 ? phase + 6 : phase;
        const a = on < 1.2 ? 1 : 0.18;
        g.fillStyle = `rgba(0, 240, 255, ${a})`;
        const s = Math.max(1.5, p.s * 0.035);
        g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      // Door status light
      const dl = proj(v, X, 2.5, 6.0);
      const red = Math.sin(t * 3) > 0;
      radialGlow(g, dl.x, dl.y, 16, red ? '255, 40, 70' : '0, 255, 120', 0.9);
    }

    // Console screens with scrolling telemetry
    for (const side of [-1, 1]) {
      const x0 = Math.min(side * xWall * 0.65, side * xWall * 0.90);
      const x1 = Math.max(side * xWall * 0.65, side * xWall * 0.90);
      const s0 = proj(v, x0 + 0.06, 0.9, 6.25);
      const s1 = proj(v, x1 - 0.06, 0.9, 6.25);
      const s2 = proj(v, x1 - 0.06, 1.4, 6.95);
      const s3 = proj(v, x0 + 0.06, 1.4, 6.95);
      g.save();
      g.beginPath();
      g.moveTo(s0.x, s0.y);
      g.lineTo(s1.x, s1.y);
      g.lineTo(s2.x, s2.y);
      g.lineTo(s3.x, s3.y);
      g.closePath();
      g.clip();
      g.fillStyle = side < 0 ? '#03263a' : '#2a0830';
      g.fillRect(s3.x - 5, s3.y - 5, s1.x - s3.x + 10, s1.y - s3.y + 10);
      const n = 14;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const hgt = 0.5 + 0.5 * Math.sin(t * 3 + i * 0.9 + side);
        const x = s3.x + (s2.x - s3.x) * k;
        const yb = s0.y;
        g.fillStyle = side < 0 ? 'rgba(0, 240, 255, 0.85)' : 'rgba(255, 0, 140, 0.85)';
        g.fillRect(x, yb - hgt * (s0.y - s3.y) * 0.9, Math.max(1, (s2.x - s3.x) / n - 1), hgt * (s0.y - s3.y) * 0.9);
      }
      g.restore();
      radialGlow(g, (s0.x + s2.x) / 2, (s0.y + s2.y) / 2, Math.abs(s1.x - s0.x) * 0.9, side < 0 ? '0, 200, 255' : '255, 0, 140', 0.18);
    }

    // Holo-globe on far left bulkhead
    const hx = -xWall * 0.78;
    const base = proj(v, hx, 0, 5.8);
    const c = proj(v, hx, 1.25, 5.8);
    const R = 0.42 * c.s;
    const beam = g.createLinearGradient(0, base.y, 0, c.y);
    beam.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
    beam.addColorStop(1, 'rgba(0, 240, 255, 0)');
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(base.x - 0.25 * base.s, base.y);
    g.lineTo(base.x + 0.25 * base.s, base.y);
    g.lineTo(c.x + R, c.y);
    g.lineTo(c.x - R, c.y);
    g.closePath();
    g.fill();
    radialGlow(g, c.x, c.y, R * 1.8, '0, 220, 255', 0.25);
    g.strokeStyle = 'rgba(120, 240, 255, 0.75)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(c.x, c.y, R, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const ang = t * 0.9 + (i * Math.PI) / 6;
      const rx = Math.abs(Math.cos(ang)) * R;
      g.beginPath();
      g.ellipse(c.x, c.y, rx, R, 0, 0, Math.PI * 2);
      g.stroke();
    }
    for (let j = -2; j <= 2; j++) {
      const yy = (j / 3) * R;
      const rx = Math.sqrt(Math.max(0, R * R - yy * yy));
      g.beginPath();
      g.ellipse(c.x, c.y + yy, rx, rx * 0.18, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // Radar terminal on far right bulkhead
    const rc = proj(v, xWall * 0.78, 0.56, 5.8);
    const rR = 0.5 * rc.s;
    g.save();
    g.translate(rc.x, rc.y);
    g.scale(1, 0.34);
    g.strokeStyle = 'rgba(0, 255, 140, 0.55)';
    g.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) {
      g.beginPath();
      g.arc(0, 0, (rR * i) / 3, 0, Math.PI * 2);
      g.stroke();
    }
    const ang = t * 2.2;
    const sweep = g.createRadialGradient(0, 0, 0, 0, 0, rR);
    sweep.addColorStop(0, 'rgba(0,255,140,0.6)');
    sweep.addColorStop(1, 'rgba(0,255,140,0.05)');
    g.fillStyle = sweep;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, rR, ang, ang + 0.7);
    g.closePath();
    g.fill();
    for (let i = 0; i < 4; i++) {
      const ba = i * 1.7 + 0.4;
      const fade = ((ang - ba) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const a = clamp(1 - fade / 3, 0, 1);
      g.fillStyle = `rgba(160,255,200,${a})`;
      g.beginPath();
      g.arc(Math.cos(ba) * rR * (0.3 + i * 0.15), Math.sin(ba) * rR * (0.3 + i * 0.15), 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // Platform emblem pulse
    const ec = proj(v, 0, 0, 3.6);
    const pulse = (t * 0.8) % 1;
    g.strokeStyle = `rgba(0, 230, 255, ${0.45 * (1 - pulse)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(ec.x, ec.y, (1.2 + pulse * 1.4) * ec.s, (1.2 + pulse * 1.4) * ec.s * 0.33, 0, 0, Math.PI * 2);
    g.stroke();

    // Floating dust motes
    if (this.motes.length < 40 && Math.random() < 0.6) {
      this.motes.push({
        x: Math.random() * v.W,
        y: v.jY + Math.random() * (v.H - v.jY),
        vx: (Math.random() - 0.5) * 6,
        vy: -4 - Math.random() * 6,
        life: 1,
      });
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt * 0.15;
      if (m.life <= 0) {
        this.motes.splice(i, 1);
        continue;
      }
      g.fillStyle = `rgba(150, 230, 255, ${0.35 * Math.sin(m.life * Math.PI)})`;
      g.fillRect(m.x, m.y, 2, 2);
    }

    // Hyperspace flash across the whole deck
    const warp = this.warpAmount(t);
    if (warp > 0) {
      g.fillStyle = `rgba(120, 200, 255, ${warp * 0.12})`;
      g.fillRect(0, 0, v.W, v.H);
    }
  }

  drawFront(g: CanvasRenderingContext2D, v: ArenaView) {
    const warp = this.warpAmount(v.t);
    if (warp > 0.6) {
      g.fillStyle = `rgba(200, 235, 255, ${(warp - 0.6) * 0.25})`;
      g.fillRect(0, 0, v.W, v.H);
    }
    // Cool cockpit edge light
    const lg = g.createLinearGradient(0, v.H, 0, v.H * 0.75);
    lg.addColorStop(0, 'rgba(0, 120, 255, 0.16)');
    lg.addColorStop(1, 'rgba(0, 120, 255, 0)');
    g.fillStyle = lg;
    g.fillRect(0, v.H * 0.75, v.W, v.H * 0.25);
  }
}
