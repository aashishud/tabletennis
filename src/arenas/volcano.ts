import {
  type ArenaScene,
  type ArenaView,
  type TableSkinInfo,
  clamp,
  floorY,
  pathFloorQuad,
  pathSideQuad,
  proj,
  radialGlow,
  rng,
  tableSpanPath,
  tableUV,
  vignette,
} from './engine';

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

/**
 * 🌋 MAGMA FOUNDRY — underground volcanic caldera.
 * Flowing animated molten lava rivers, dark basalt rock pillars,
 * industrial iron catwalks and rising fiery ember particles.
 */
export class VolcanoScene implements ArenaScene {
  readonly id = 'volcano';
  readonly tableLine: [number, number, number] = [255, 120, 20]; // Fiery magma orange lines

  private embers: Ember[] = [];

  paintTable(g: CanvasRenderingContext2D, info: TableSkinInfo) {
    const { w, h } = info;

    // Dark obsidian volcanic rock
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#1c1619');
    base.addColorStop(0.5, '#261b1c');
    base.addColorStop(1, '#151113');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    g.save();
    tableSpanPath(g, info);
    g.clip();

    // Jagged cooling crust textures
    g.fillStyle = '#0f0c0e';
    for (let i = 0; i < 18; i++) {
      const u = (i * 0.17) % 1;
      const vv = (i * 0.23) % 1;
      const pt = tableUV(info, u, vv);
      g.beginPath();
      g.arc(pt.x, pt.y, 25 + (i % 4) * 15, 0, Math.PI * 2);
      g.fill();
    }

    // Glowing molten lava cracks branching across the table
    g.strokeStyle = 'rgba(255, 80, 0, 0.45)';
    g.lineWidth = 3;
    g.beginPath();
    const c0 = tableUV(info, 0.1, 0.2);
    const c1 = tableUV(info, 0.35, 0.45);
    const c2 = tableUV(info, 0.65, 0.42);
    const c3 = tableUV(info, 0.9, 0.7);
    g.moveTo(c0.x, c0.y);
    g.lineTo(c1.x, c1.y);
    g.lineTo(c2.x, c2.y);
    g.lineTo(c3.x, c3.y);
    g.stroke();

    // Hot golden core inside the crack
    g.strokeStyle = 'rgba(255, 220, 80, 0.65)';
    g.lineWidth = 1.2;
    g.stroke();

    // Central magma glow
    const center = tableUV(info, 0.5, 0.55);
    const mg = g.createRadialGradient(center.x, center.y, 10, center.x, center.y, w * 0.35);
    mg.addColorStop(0, 'rgba(255, 100, 0, 0.35)');
    mg.addColorStop(0.6, 'rgba(255, 50, 0, 0.15)');
    mg.addColorStop(1, 'rgba(255, 50, 0, 0)');
    g.fillStyle = mg;
    g.fillRect(0, 0, w, h);

    g.restore();
  }

  reset(v: ArenaView) {
    this.embers = [];
    const r = rng(19);
    for (let i = 0; i < 60; i++) {
      this.embers.push({
        x: r() * v.W,
        y: v.jY + r() * (v.H - v.jY),
        vx: (r() - 0.5) * 20,
        vy: -25 - r() * 55,
        size: 1 + r() * 2.5,
        life: r() * 2.5,
        maxLife: 2.5,
      });
    }
  }

  drawBack(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, H, t } = v;

    // Dark cavernous volcano ceiling with glowing sulfur smoke
    const cave = g.createLinearGradient(0, 0, 0, v.jY);
    cave.addColorStop(0, '#0f0504');
    cave.addColorStop(0.5, '#280c07');
    cave.addColorStop(0.9, '#4a1506');
    cave.addColorStop(1, '#662208');
    g.fillStyle = cave;
    g.fillRect(0, 0, W, H);

    // Jagged basalt rock cavern ceiling stalactites
    g.fillStyle = '#140605';
    for (let s = 0; s < 12; s++) {
      const sx = (s / 12) * W;
      const sw = W / 10;
      const sh = 35 + ((s * 37) % 75);
      g.beginPath();
      g.moveTo(sx - sw / 2, 0);
      g.lineTo(sx + sw / 2, 0);
      g.lineTo(sx, sh);
      g.closePath();
      g.fill();
    }

    // Distant erupting lava vent on back horizon
    const ventX = W * 0.5;
    const ventY = v.jY * 0.85;
    const lavaPulse = 0.85 + Math.sin(t * 3.5) * 0.15;
    radialGlow(g, ventX, ventY, 180 * lavaPulse, '255, 70, 0', 0.85);
    radialGlow(g, ventX, ventY, 80 * lavaPulse, '255, 180, 40', 0.95);
  }

  drawStatic(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, zWall, xWall } = v;

    /* ---------- Underground Basalt Platform Floor & Magma Channels ---------- */
    // Dark volcanic ash stone floor
    const flG = g.createLinearGradient(0, v.jY, 0, v.H);
    flG.addColorStop(0, '#24120f');
    flG.addColorStop(0.6, '#1a0b08');
    flG.addColorStop(1, '#0e0504');
    g.fillStyle = flG;
    pathFloorQuad(g, v, -xWall * 1.3, xWall * 1.3, 0.5, zWall);
    g.fill();

    // Heavy iron floor grating & expansion joints
    for (let z = 1.2; z < zWall; z += 1.4) {
      const py = floorY(v, z);
      const pl = proj(v, -xWall, 0, z);
      const pr = proj(v, xWall, 0, z);
      g.strokeStyle = '#38160e';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(pl.x, py);
      g.lineTo(pr.x, py);
      g.stroke();
    }

    /* ---------- Massive Basalt Columns on Left & Right ---------- */
    for (const side of [-1, 1]) {
      const colX = side * xWall * 0.82;
      const c0 = proj(v, colX, 0, 4.0);
      const cw = 36 * (v.f / 4.0) / 120;

      // Hexagonal basalt pillar
      const colG = g.createLinearGradient(c0.x - cw / 2, 0, c0.x + cw / 2, 0);
      colG.addColorStop(0, '#120706');
      colG.addColorStop(0.5, '#2e120d');
      colG.addColorStop(1, '#180907');
      g.fillStyle = colG;
      g.fillRect(c0.x - cw / 2, -100, cw, c0.y + 100);

      // Glowing lava crack inside the column
      g.strokeStyle = 'rgba(255, 90, 0, 0.6)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(c0.x - cw * 0.2, c0.y);
      g.lineTo(c0.x + cw * 0.1, c0.y - 80);
      g.lineTo(c0.x - cw * 0.1, c0.y - 160);
      g.stroke();
    }

    /* ---------- Heavy Industrial Catwalk Railing (Back Wall) ---------- */
    const railY0 = 0;
    const railY1 = 1.25;
    const topL = proj(v, -xWall, railY1, zWall);
    const topR = proj(v, xWall, railY1, zWall);

    // Iron hazard railing
    g.fillStyle = '#220b07';
    g.fillRect(topL.x, topL.y, topR.x - topL.x, 8);
    g.fillStyle = '#ff6600';
    g.fillRect(topL.x, topL.y + 1, topR.x - topL.x, 2);

    // Vertical iron supports
    const posts = 18;
    for (let p = 0; p <= posts; p++) {
      const X = -xWall + (p / posts) * (xWall * 2);
      const b0 = proj(v, X, railY0, zWall);
      const b1 = proj(v, X, railY1, zWall);
      g.fillStyle = '#1c0805';
      g.fillRect(b0.x - 3, b1.y, 6, b0.y - b1.y);
    }

    vignette(g, v, '20, 5, 2', 0.62);
  }

  drawMid(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, t, dt } = v;

    // Animated Molten Lava River running across the back wall
    const riverY = v.jY - 12;
    const lavaGrad = g.createLinearGradient(0, riverY - 16, 0, riverY + 16);
    lavaGrad.addColorStop(0, '#ff3300');
    lavaGrad.addColorStop(0.5, '#ffaa00');
    lavaGrad.addColorStop(1, '#cc2200');
    g.fillStyle = lavaGrad;
    g.fillRect(0, riverY - 8, W, 18);

    // Glowing molten lava bubbles & ripples
    for (let b = 0; b < 12; b++) {
      const bx = ((b * 120 + t * 45) % (W + 100)) - 50;
      const by = riverY + Math.sin(t * 4 + b) * 3;
      const bRad = 6 + Math.sin(t * 5 + b * 2) * 4;
      g.fillStyle = 'rgba(255, 240, 160, 0.85)';
      g.beginPath();
      g.arc(bx, by, bRad, 0, Math.PI * 2);
      g.fill();
    }

    // Ambient magma pulse along the table edge
    const pulse = 0.8 + Math.sin(t * 2.8) * 0.2;
    radialGlow(g, W * 0.5, v.jY + 40, W * 0.45 * pulse, '255, 65, 0', 0.22);

    // Rising fiery ember particles floating up through the heat
    if (this.embers.length < 70 && Math.random() < 0.8) {
      this.embers.push({
        x: Math.random() * W,
        y: v.H + 10,
        vx: (Math.random() - 0.5) * 25,
        vy: -35 - Math.random() * 55,
        size: 1.5 + Math.random() * 2.5,
        life: 0,
        maxLife: 2.2 + Math.random() * 1.5,
      });
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.x += e.vx * dt + Math.sin(t * 3 + i) * 0.4;
      e.y += e.vy * dt;
      e.life += dt;
      if (e.life >= e.maxLife || e.y < -10) {
        this.embers.splice(i, 1);
        continue;
      }
      const progress = e.life / e.maxLife;
      const alpha = Math.sin(progress * Math.PI);
      const col = progress < 0.4 ? '255, 230, 110' : progress < 0.7 ? '255, 110, 20' : '200, 40, 10';
      g.fillStyle = `rgba(${col}, ${alpha * 0.85})`;
      g.beginPath();
      g.arc(e.x, e.y, e.size * (1 - progress * 0.4), 0, Math.PI * 2);
      g.fill();
    }
  }

  drawFront(g: CanvasRenderingContext2D, v: ArenaView) {
    // Warm fiery bottom glow
    const glow = g.createLinearGradient(0, v.H, 0, v.H * 0.78);
    glow.addColorStop(0, 'rgba(255, 70, 0, 0.16)');
    glow.addColorStop(1, 'rgba(255, 70, 0, 0)');
    g.fillStyle = glow;
    g.fillRect(0, v.H * 0.78, v.W, v.H * 0.22);
  }
}
