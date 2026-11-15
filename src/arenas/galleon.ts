import {
  type ArenaScene,
  type ArenaView,
  type TableSkinInfo,
  clamp,
  drawBox,
  floorY,
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

interface SeaSpray {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

/**
 * 🏴‍☠️ PIRATE GALLEON — high seas at storm dusk.
 * Rolling ocean waves, stormy tempest clouds, distant silhouette pirate vessel,
 * weathered oak ship deck with brass railings, swaying ship lanterns,
 * rigging ropes, and flying sea spray.
 */
export class GalleonScene implements ArenaScene {
  readonly id = 'galleon';
  readonly tableLine: [number, number, number] = [255, 215, 90]; // Golden brass lines

  private sprays: SeaSpray[] = [];
  private lightningTimer = 8;
  private lightningFlash = 0;

  paintTable(g: CanvasRenderingContext2D, info: TableSkinInfo) {
    const { w, h } = info;

    // Dark nautical mahogany wood grain
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2d1406');
    grad.addColorStop(0.5, '#3b1c0a');
    grad.addColorStop(1, '#240f04');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    g.save();
    tableSpanPath(g, info);
    g.clip();

    // Wood planks running lengthwise
    const planks = 8;
    g.strokeStyle = 'rgba(15, 6, 2, 0.65)';
    g.lineWidth = 1.8;
    for (let i = 1; i < planks; i++) {
      const u = i / planks;
      const a = tableUV(info, u, 0);
      const b = tableUV(info, u, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // Wood grain lines
    g.strokeStyle = 'rgba(255, 180, 100, 0.08)';
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const u = (i + 0.3) / 24;
      const a = tableUV(info, u, 0);
      const b = tableUV(info, u + (i % 2 === 0 ? 0.02 : -0.02), 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // Golden Nautical Compass Rose Emblem in center
    const c = tableUV(info, 0.5, 0.56);
    const R = w * 0.16;

    // Compass circle
    g.strokeStyle = 'rgba(255, 215, 80, 0.38)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.ellipse(c.x, c.y, R, R * 0.55, 0, 0, Math.PI * 2);
    g.stroke();

    // Inner ring
    g.strokeStyle = 'rgba(255, 190, 60, 0.25)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(c.x, c.y, R * 0.65, R * 0.65 * 0.55, 0, 0, Math.PI * 2);
    g.stroke();

    // 8-point compass star
    g.fillStyle = 'rgba(255, 215, 80, 0.3)';
    for (let p = 0; p < 4; p++) {
      const ang = (p * Math.PI) / 2;
      const x1 = c.x + Math.cos(ang) * R * 1.1;
      const y1 = c.y + Math.sin(ang) * (R * 1.1) * 0.55;
      const x2 = c.x + Math.cos(ang + 0.38) * (R * 0.35);
      const y2 = c.y + Math.sin(ang + 0.38) * (R * 0.35) * 0.55;
      const x3 = c.x + Math.cos(ang - 0.38) * (R * 0.35);
      const y3 = c.y + Math.sin(ang - 0.38) * (R * 0.35) * 0.55;
      g.beginPath();
      g.moveTo(c.x, c.y);
      g.lineTo(x2, y2);
      g.lineTo(x1, y1);
      g.lineTo(x3, y3);
      g.closePath();
      g.fill();
    }

    g.restore();
  }

  reset(v: ArenaView) {
    this.sprays = [];
    const r = rng(42);
    for (let i = 0; i < 45; i++) {
      this.sprays.push({
        x: r() * v.W,
        y: v.jY + r() * (v.H - v.jY),
        vx: -25 - r() * 55,
        vy: -15 - r() * 30,
        life: r(),
        size: 1 + r() * 2.5,
      });
    }
  }

  drawBack(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, H, t, dt } = v;

    // Lightning generator
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = 6 + Math.random() * 8;
      this.lightningFlash = 1.0;
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.5);
    }

    // Tempest sky: dark violet storm clouds + stormy sunset horizon
    const sky = g.createLinearGradient(0, 0, 0, v.jY);
    sky.addColorStop(0, '#0c0b1a');
    sky.addColorStop(0.5, '#1e1b36');
    sky.addColorStop(0.85, '#42243d');
    sky.addColorStop(1, '#663738');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Lightning burst
    if (this.lightningFlash > 0.05) {
      g.fillStyle = `rgba(220, 235, 255, ${this.lightningFlash * 0.4})`;
      g.fillRect(0, 0, W, H);
      // Lightning bolt silhouette
      g.strokeStyle = `rgba(255, 255, 255, ${this.lightningFlash * 0.8})`;
      g.lineWidth = 2.5;
      g.beginPath();
      const lx = W * 0.38;
      g.moveTo(lx, 0);
      g.lineTo(lx - 25, v.jY * 0.28);
      g.lineTo(lx - 8, v.jY * 0.34);
      g.lineTo(lx - 38, v.jY * 0.65);
      g.lineTo(lx - 20, v.jY * 0.72);
      g.lineTo(lx - 45, v.jY * 0.98);
      g.stroke();
    }

    // Heavy rolling storm clouds
    for (let c = 0; c < 5; c++) {
      const cx = ((c * 240 + t * 12) % (W + 400)) - 200;
      const cy = v.jY * 0.3 + Math.sin(t * 0.4 + c) * 15;
      const cr = 140 + c * 35;
      const cg = g.createRadialGradient(cx, cy, 20, cx, cy, cr);
      cg.addColorStop(0, 'rgba(30, 25, 48, 0.7)');
      cg.addColorStop(0.7, 'rgba(20, 16, 32, 0.45)');
      cg.addColorStop(1, 'rgba(10, 8, 20, 0)');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(cx, cy, cr, 0, Math.PI * 2);
      g.fill();
    }

    // Distant pirate galleon silhouette sailing on horizon
    const shipX = ((t * 8) % (W + 280)) - 140;
    const shipY = v.jY * 0.88 + Math.sin(t * 1.4) * 4;
    g.save();
    g.translate(shipX, shipY);
    g.fillStyle = '#130e1c';
    // Hull
    g.beginPath();
    g.moveTo(-45, 0);
    g.lineTo(35, 0);
    g.lineTo(48, -12);
    g.lineTo(25, -12);
    g.lineTo(-35, -9);
    g.closePath();
    g.fill();
    // 3 Masts
    g.fillRect(-20, -42, 2.5, 42);
    g.fillRect(5, -52, 3, 52);
    g.fillRect(28, -36, 2, 36);
    // Billowing sails
    g.fillStyle = '#20182c';
    g.beginPath();
    g.ellipse(-20, -28, 12, 10, 0, 0, Math.PI * 2);
    g.ellipse(5, -34, 15, 12, 0, 0, Math.PI * 2);
    g.ellipse(28, -24, 10, 8, 0, 0, Math.PI * 2);
    g.fill();
    // Tiny pirate flag
    g.fillStyle = '#ff2244';
    g.fillRect(5, -54, 8, 4);
    g.restore();

    // Rolling ocean waves (3 layers)
    const waveBaseY = v.jY * 0.92;
    for (let layer = 0; layer < 3; layer++) {
      const waveCols = ['#1a2b3c', '#152230', '#0e1724'];
      g.fillStyle = waveCols[layer];
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(0, waveBaseY + layer * 14);
      for (let x = 0; x <= W; x += 30) {
        const freq = 0.012 - layer * 0.002;
        const spd = (1.8 + layer * 0.6) * t;
        const wy = waveBaseY + layer * 16 + Math.sin(x * freq + spd) * (8 + layer * 4) + Math.cos(x * 0.02 - spd * 0.5) * 4;
        g.lineTo(x, wy);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();

      // White wave crest foam
      g.strokeStyle = 'rgba(210, 240, 255, 0.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= W; x += 40) {
        const freq = 0.012 - layer * 0.002;
        const spd = (1.8 + layer * 0.6) * t;
        const wy = waveBaseY + layer * 16 + Math.sin(x * freq + spd) * (8 + layer * 4);
        if (Math.sin(x * 0.04 + spd) > 0.4) {
          g.moveTo(x - 12, wy);
          g.lineTo(x + 12, wy);
        }
      }
      g.stroke();
    }
  }

  drawStatic(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, zWall, xWall } = v;

    /* ---------- Weathered Wooden Ship Deck (Floor) ---------- */
    // Dark weathered oak deck
    const flG = g.createLinearGradient(0, v.jY, 0, v.H);
    flG.addColorStop(0, '#3a2717');
    flG.addColorStop(0.6, '#281a0e');
    flG.addColorStop(1, '#1b1008');
    g.fillStyle = flG;
    pathFloorQuad(g, v, -xWall * 1.3, xWall * 1.3, 0.5, zWall);
    g.fill();

    // Lengthwise ship deck planks with wood grain
    for (let X = -Math.ceil(xWall); X <= xWall; X += 0.45) {
      const p0 = proj(v, X, 0, zWall);
      const p1 = proj(v, X, 0, 0.6);
      g.strokeStyle = 'rgba(12, 7, 3, 0.75)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();

      // Golden brass deck nails / rivets along the planks
      g.fillStyle = 'rgba(220, 180, 80, 0.45)';
      for (let z = 1.2; z < zWall; z += 1.3) {
        const np = proj(v, X + 0.08, 0, z);
        g.fillRect(np.x - 1.5, np.y - 1.5, 3, 3);
      }
    }

    // Heavy wooden deck crossbeams
    for (let z = 2.0; z < zWall; z += 2.2) {
      const py = floorY(v, z);
      const pl = proj(v, -xWall, 0, z);
      const pr = proj(v, xWall, 0, z);
      g.strokeStyle = 'rgba(20, 12, 6, 0.85)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(pl.x, py);
      g.lineTo(pr.x, py);
      g.stroke();
    }

    /* ---------- Ship Stern Castle & Railings (Back Wall) ---------- */
    // Wooden stern railing along back wall
    const railY0 = 0;
    const railY1 = 1.35;
    const rL = proj(v, -xWall, railY0, zWall);
    const rR = proj(v, xWall, railY0, zWall);
    const topL = proj(v, -xWall, railY1, zWall);
    const topR = proj(v, xWall, railY1, zWall);

    // Turned balusters (rail posts)
    const postCount = 28;
    for (let i = 0; i <= postCount; i++) {
      const X = -xWall + (i / postCount) * (xWall * 2);
      const b0 = proj(v, X, railY0, zWall);
      const b1 = proj(v, X, railY1, zWall);
      const pw = Math.max(4, 9 * b0.s / 80);

      const postG = g.createLinearGradient(b0.x - pw / 2, 0, b0.x + pw / 2, 0);
      postG.addColorStop(0, '#2c1b0c');
      postG.addColorStop(0.5, '#56371c');
      postG.addColorStop(1, '#201308');
      g.fillStyle = postG;
      g.fillRect(b0.x - pw / 2, b1.y, pw, b0.y - b1.y);

      // Brass banding on posts
      g.fillStyle = 'rgba(240, 195, 75, 0.75)';
      g.fillRect(b0.x - pw / 2, b1.y + (b0.y - b1.y) * 0.3, pw, 2.5);
      g.fillRect(b0.x - pw / 2, b1.y + (b0.y - b1.y) * 0.7, pw, 2.5);
    }

    // Heavy polished top rail with brass trim
    const railH = 12;
    const railGrad = g.createLinearGradient(0, topL.y - railH, 0, topL.y);
    railGrad.addColorStop(0, '#56371c');
    railGrad.addColorStop(0.5, '#734c28');
    railGrad.addColorStop(1, '#341f0e');
    g.fillStyle = railGrad;
    g.fillRect(topL.x, topL.y - railH, topR.x - topL.x, railH);

    // Brass top cap
    g.fillStyle = '#e5b84c';
    g.fillRect(topL.x, topL.y - railH, topR.x - topL.x, 3);

    // Central Ship's Steering Wheel in background
    const wheelCenter = proj(v, 0, 1.7, zWall + 0.6);
    const wr = 38;
    g.strokeStyle = '#5a381c';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(wheelCenter.x, wheelCenter.y, wr, 0, Math.PI * 2);
    g.stroke();
    // Brass inner hub
    g.fillStyle = '#e5b84c';
    g.beginPath();
    g.arc(wheelCenter.x, wheelCenter.y, 10, 0, Math.PI * 2);
    g.fill();
    // 8 Wooden spokes with turned handles
    g.strokeStyle = '#5a381c';
    g.lineWidth = 4;
    for (let s = 0; s < 8; s++) {
      const a = (s * Math.PI) / 4;
      g.beginPath();
      g.moveTo(wheelCenter.x, wheelCenter.y);
      g.lineTo(wheelCenter.x + Math.cos(a) * (wr + 12), wheelCenter.y + Math.sin(a) * (wr + 12));
      g.stroke();
      // Handle peg
      g.fillStyle = '#e5b84c';
      g.fillRect(wheelCenter.x + Math.cos(a) * (wr + 8) - 2.5, wheelCenter.y + Math.sin(a) * (wr + 8) - 2.5, 5, 5);
    }

    /* ---------- Left & Right Ship Rigging Masts & Cannons ---------- */
    for (const side of [-1, 1]) {
      const mastX = side * xWall * 0.88;
      // Massive wooden mast
      const m0 = proj(v, mastX, 0, 4.2);
      const m1 = proj(v, mastX, 10, 4.2);
      const mw = 32 * (v.f / 4.2) / 120;
      const mastG = g.createLinearGradient(m0.x - mw / 2, 0, m0.x + mw / 2, 0);
      mastG.addColorStop(0, '#26170a');
      mastG.addColorStop(0.5, '#4e3017');
      mastG.addColorStop(1, '#1e1106');
      g.fillStyle = mastG;
      g.fillRect(m0.x - mw / 2, -100, mw, m0.y + 100);

      // Heavy hemp rope rigging running diagonally from mast down to ship railings
      g.strokeStyle = 'rgba(160, 130, 85, 0.55)';
      g.lineWidth = 2;
      for (let r = 0; r < 5; r++) {
        const deckRopePt = proj(v, side * xWall * 0.98, railY1, 2.0 + r * 1.4);
        g.beginPath();
        g.moveTo(m0.x, -50 + r * 30);
        g.lineTo(deckRopePt.x, deckRopePt.y);
        g.stroke();
      }

      // Heavy Bronze Ship Cannon on Gun Carriage
      const cannonX0 = side * (xWall * 0.65);
      const cannonX1 = side * (xWall * 0.85);
      drawBox(
        g,
        v,
        Math.min(cannonX0, cannonX1),
        Math.max(cannonX0, cannonX1),
        0,
        0.58,
        4.8,
        6.0,
        '#422b17', // Dark wood carriage
        '#5e3f22',
        '#2a1b0c'
      );
      // Bronze cannon barrel pointing outboard
      const cb0 = proj(v, (cannonX0 + cannonX1) / 2, 0.65, 5.4);
      const cb1 = proj(v, (cannonX0 + cannonX1) / 2 + side * 0.8, 0.72, 5.4);
      const bG = g.createLinearGradient(0, cb0.y - 12, 0, cb0.y + 12);
      bG.addColorStop(0, '#c79c38');
      bG.addColorStop(0.5, '#e5ba4c');
      bG.addColorStop(1, '#85631c');
      g.strokeStyle = bG;
      g.lineWidth = 14;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cb0.x, cb0.y);
      g.lineTo(cb1.x, cb1.y);
      g.stroke();
      g.lineCap = 'butt';
    }

    /* ---------- Nautical Brass Lanterns (Static mounts) ---------- */
    for (const side of [-1, 1]) {
      const lx = side * xWall * 0.55;
      const lp = proj(v, lx, 1.4, zWall);
      // Iron bracket
      g.strokeStyle = '#1e140d';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(lp.x, lp.y + 45);
      g.lineTo(lp.x, lp.y);
      g.lineTo(lp.x - side * 14, lp.y);
      g.stroke();
    }

    vignette(g, v, '12, 7, 3', 0.58);
  }

  drawMid(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, t, dt, xWall, zWall } = v;

    // Swaying brass ship lanterns with flickering golden candlelight
    for (const side of [-1, 1]) {
      const lx = side * xWall * 0.55;
      const lp = proj(v, lx, 1.4, zWall);
      const sway = Math.sin(t * 1.8 + side) * 0.08;

      g.save();
      g.translate(lp.x, lp.y);
      g.rotate(sway);

      // Lantern body
      g.fillStyle = '#c89e3a';
      g.fillRect(-11, 0, 22, 28);
      // Glass chamber with glowing flame
      g.fillStyle = '#fffae0';
      g.fillRect(-8, 4, 16, 20);

      // Flickering candle flame
      const flick = 0.85 + Math.sin(t * 14 + side * 3) * 0.15;
      radialGlow(g, 0, 14, 45 * flick, '255, 180, 40', 0.85);
      radialGlow(g, 0, 14, 18, '255, 240, 150', 0.95);

      // Iron cage bars
      g.strokeStyle = '#34220f';
      g.lineWidth = 2;
      g.strokeRect(-11, 0, 22, 28);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, 28);
      g.stroke();

      g.restore();
    }

    // Flying sea spray particles blown across the deck by storm wind
    if (this.sprays.length < 60 && Math.random() < 0.8) {
      this.sprays.push({
        x: W + 20,
        y: v.jY * 0.8 + Math.random() * (v.H - v.jY * 0.8),
        vx: -120 - Math.random() * 160,
        vy: -20 - Math.random() * 45,
        life: 1.0,
        size: 1.5 + Math.random() * 2.5,
      });
    }

    for (let i = this.sprays.length - 1; i >= 0; i--) {
      const s = this.sprays[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.9;
      if (s.life <= 0 || s.x < -20) {
        this.sprays.splice(i, 1);
        continue;
      }
      g.fillStyle = `rgba(220, 245, 255, ${0.45 * Math.sin(s.life * Math.PI)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawFront(g: CanvasRenderingContext2D, v: ArenaView) {
    // Soft salty sea mist vignette at bottom corners
    const mist = g.createLinearGradient(0, v.H, 0, v.H * 0.82);
    mist.addColorStop(0, 'rgba(180, 215, 240, 0.12)');
    mist.addColorStop(1, 'rgba(180, 215, 240, 0)');
    g.fillStyle = mist;
    g.fillRect(0, v.H * 0.82, v.W, v.H * 0.18);
  }
}
