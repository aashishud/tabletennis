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

interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  size: number;
  life: number;
  maxLife: number;
}

interface Hovercar {
  x: number;
  y: number;
  speed: number;
  color: string;
  len: number;
}

/**
 * 🌸 NEO TOKYO ROOFTOP — cyberpunk penthouse overlooking neon Shinjuku.
 * Towering holographic skyscraper billboards, zipping flying hovercar traffic,
 * glowing neon rooftop helipad, and drifting pink sakura cherry blossom petals.
 */
export class CyberCityScene implements ArenaScene {
  readonly id = 'cybercity';
  readonly tableLine: [number, number, number] = [0, 240, 255]; // Electric cyan laser lines

  private petals: Petal[] = [];
  private hovercars: Hovercar[] = [];

  paintTable(g: CanvasRenderingContext2D, info: TableSkinInfo) {
    const { w, h } = info;

    // Midnight purple-violet acrylic court
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#15092a');
    base.addColorStop(0.5, '#220e3d');
    base.addColorStop(1, '#110624');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    g.save();
    tableSpanPath(g, info);
    g.clip();

    // Hot neon pink & cyan circuit traces
    g.strokeStyle = 'rgba(255, 0, 140, 0.28)';
    g.lineWidth = 1.8;
    for (let i = 1; i <= 6; i++) {
      const u = i / 7;
      const a = tableUV(info, u, 0);
      const b = tableUV(info, u, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // Glowing Sakura Blossom Logo in court center
    const c = tableUV(info, 0.5, 0.58);
    const R = w * 0.14;

    // 5-petal sakura flower
    g.fillStyle = 'rgba(255, 100, 180, 0.35)';
    for (let p = 0; p < 5; p++) {
      const ang = (p * Math.PI * 2) / 5 - Math.PI / 2;
      const px = c.x + Math.cos(ang) * R * 0.65;
      const py = c.y + Math.sin(ang) * (R * 0.65) * 0.55;
      g.beginPath();
      g.ellipse(px, py, R * 0.42, R * 0.22, ang, 0, Math.PI * 2);
      g.fill();
    }

    // Flower center core
    g.fillStyle = 'rgba(0, 240, 255, 0.6)';
    g.beginPath();
    g.arc(c.x, c.y, R * 0.16, 0, Math.PI * 2);
    g.fill();

    // Neon table rim glow
    const rg = g.createRadialGradient(c.x, c.y, 10, c.x, c.y, w * 0.42);
    rg.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
    rg.addColorStop(1, 'rgba(0, 240, 255, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);

    g.restore();
  }

  reset(v: ArenaView) {
    this.petals = [];
    this.hovercars = [];
    const r = rng(88);
    for (let i = 0; i < 50; i++) {
      this.petals.push({
        x: r() * v.W,
        y: r() * v.H,
        vx: -20 - r() * 35,
        vy: 20 + r() * 35,
        rot: r() * Math.PI * 2,
        vRot: (r() - 0.5) * 3,
        size: 3 + r() * 4,
        life: r() * 4,
        maxLife: 4 + r() * 2,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.hovercars.push({
        x: r() * v.W,
        y: v.jY * (0.2 + r() * 0.6),
        speed: (r() < 0.5 ? -1 : 1) * (180 + r() * 220),
        color: r() < 0.5 ? '#00f0ff' : '#ff007f',
        len: 25 + r() * 35,
      });
    }
  }

  drawBack(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, H } = v;

    // Dark cyberpunk midnight sky: violet to black
    const sky = g.createLinearGradient(0, 0, 0, v.jY);
    sky.addColorStop(0, '#05020d');
    sky.addColorStop(0.5, '#120726');
    sky.addColorStop(1, '#260a38');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Glowing full moon through smog
    const mx = W * 0.72;
    const my = v.jY * 0.32;
    const mr = 42;
    radialGlow(g, mx, my, 110, '255, 0, 140', 0.25);
    const mg = g.createRadialGradient(mx, my, 5, mx, my, mr);
    mg.addColorStop(0, '#fff4f9');
    mg.addColorStop(0.7, '#ff80bf');
    mg.addColorStop(1, 'rgba(255, 0, 128, 0.2)');
    g.fillStyle = mg;
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();

    // Dense Neo-Tokyo Skyscraper Skyline in background
    const towers = [
      { x: W * 0.08, w: 75, h: 220, color: '#130825', sign: 'PONG' },
      { x: W * 0.24, w: 95, h: 280, color: '#180a2f', sign: '東京' },
      { x: W * 0.42, w: 120, h: 320, color: '#0d041c', sign: 'NEO' },
      { x: W * 0.62, w: 85, h: 260, color: '#1b0c36', sign: 'CYBER' },
      { x: W * 0.82, w: 105, h: 290, color: '#110522', sign: '電脳' },
    ];

    for (const t of towers) {
      const ty = v.jY - t.h * 0.85;
      g.fillStyle = t.color;
      g.fillRect(t.x - t.w / 2, ty, t.w, v.jY - ty);

      // Window grid lights
      g.fillStyle = 'rgba(0, 240, 255, 0.45)';
      for (let r = 0; r < 14; r++) {
        for (let c = 0; c < 3; c++) {
          if ((r + c) % 3 === 0) {
            g.fillRect(t.x - t.w / 2 + 10 + c * 24, ty + 20 + r * 16, 6, 8);
          }
        }
      }

      // Tower antenna with blinking red beacon
      g.strokeStyle = '#33124d';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(t.x, ty);
      g.lineTo(t.x, ty - 38);
      g.stroke();

      const beacon = Math.sin(v.t * 4 + t.x) > 0.3;
      if (beacon) {
        radialGlow(g, t.x, ty - 38, 12, '255, 40, 70', 0.95);
      }
    }
  }

  drawStatic(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, zWall, xWall } = v;

    /* ---------- Rooftop Penthouse Helipad Court (Floor) ---------- */
    // Dark carbon composite tiles
    const flG = g.createLinearGradient(0, v.jY, 0, v.H);
    flG.addColorStop(0, '#1c1033');
    flG.addColorStop(0.5, '#120822');
    flG.addColorStop(1, '#090312');
    g.fillStyle = flG;
    pathFloorQuad(g, v, -xWall * 1.3, xWall * 1.3, 0.5, zWall);
    g.fill();

    // Large glowing neon Helipad circle on the roof
    const hc = proj(v, 0, 0, 3.8);
    g.strokeStyle = 'rgba(255, 0, 140, 0.55)';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(hc.x, hc.y, 2.2 * hc.s, 2.2 * hc.s * 0.35, 0, 0, Math.PI * 2);
    g.stroke();

    // Outer cyan perimeter ring
    g.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(hc.x, hc.y, 2.8 * hc.s, 2.8 * hc.s * 0.35, 0, 0, Math.PI * 2);
    g.stroke();

    /* ---------- Glass Perimeter Rooftop Barrier with Neon Edge ---------- */
    const railY0 = 0;
    const railY1 = 1.3;
    const topL = proj(v, -xWall, railY1, zWall);
    const topR = proj(v, xWall, railY1, zWall);

    // Glowing Neon Glass Railing
    g.fillStyle = 'rgba(120, 40, 200, 0.18)';
    g.fillRect(topL.x, topL.y, topR.x - topL.x, v.jY - topL.y);

    // Radiant magenta neon edge on top of railing
    g.fillStyle = '#ff007f';
    g.fillRect(topL.x, topL.y - 2, topR.x - topL.x, 4);
    g.fillStyle = '#ffffff';
    g.fillRect(topL.x, topL.y - 1, topR.x - topL.x, 2);

    // Glass panel structural posts
    const posts = 14;
    for (let p = 0; p <= posts; p++) {
      const X = -xWall + (p / posts) * (xWall * 2);
      const b0 = proj(v, X, railY0, zWall);
      const b1 = proj(v, X, railY1, zWall);
      g.fillStyle = '#2d144d';
      g.fillRect(b0.x - 2.5, b1.y, 5, b0.y - b1.y);
    }

    /* ---------- Neon Hologram Billboards flanking the court ---------- */
    for (const side of [-1, 1]) {
      const hx = side * xWall * 0.72;
      const b0 = proj(v, hx, 0.2, 5.0);
      const bw = 65;
      const bh = 110;

      // Holographic projector pillar
      g.fillStyle = '#1c0933';
      g.fillRect(b0.x - bw / 2, b0.y - bh, bw, bh);

      // Neon frame
      g.strokeStyle = side < 0 ? '#ff007f' : '#00f0ff';
      g.lineWidth = 2.5;
      g.strokeRect(b0.x - bw / 2, b0.y - bh, bw, bh);

      // Kanji neon text on billboard
      g.fillStyle = side < 0 ? '#ff66c4' : '#66f5ff';
      g.font = '900 24px monospace';
      g.textAlign = 'center';
      g.fillText(side < 0 ? '超' : '電', b0.x, b0.y - bh + 42);
      g.fillText(side < 0 ? '力' : '脳', b0.x, b0.y - bh + 78);
    }

    vignette(g, v, '18, 5, 30', 0.58);
  }

  drawMid(g: CanvasRenderingContext2D, v: ArenaView) {
    const { W, t, dt } = v;

    // Flying hovercars zipping through the skyline in the distance
    for (const hc of this.hovercars) {
      hc.x += hc.speed * dt;
      if (hc.speed > 0 && hc.x > W + 60) hc.x = -60;
      if (hc.speed < 0 && hc.x < -60) hc.x = W + 60;

      // Trail streak
      g.strokeStyle = hc.color;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(hc.x, hc.y);
      g.lineTo(hc.x - (hc.speed > 0 ? hc.len : -hc.len), hc.y);
      g.stroke();
      g.lineCap = 'butt';

      radialGlow(g, hc.x, hc.y, 14, hc.color === '#00f0ff' ? '0, 240, 255' : '255, 0, 140', 0.65);
    }

    // Drifting Sakura Cherry Blossom Petals caught in the gentle rooftop breeze
    if (this.petals.length < 55 && Math.random() < 0.7) {
      this.petals.push({
        x: W + 20,
        y: Math.random() * (v.H * 0.7),
        vx: -35 - Math.random() * 50,
        vy: 20 + Math.random() * 40,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 3,
        size: 3 + Math.random() * 4.5,
        life: 0,
        maxLife: 4.5 + Math.random() * 2,
      });
    }

    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt + Math.sin(t * 2.5 + i) * 0.5;
      p.rot += p.vRot * dt;
      p.life += dt;
      if (p.life >= p.maxLife || p.x < -20 || p.y > v.H + 20) {
        this.petals.splice(i, 1);
        continue;
      }
      const alpha = Math.sin((p.life / p.maxLife) * Math.PI);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = `rgba(255, 140, 195, ${alpha * 0.85})`;
      g.beginPath();
      g.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  drawFront(g: CanvasRenderingContext2D, v: ArenaView) {
    // Cyberpunk purple-cyan ambient haze at bottom
    const haze = g.createLinearGradient(0, v.H, 0, v.H * 0.8);
    haze.addColorStop(0, 'rgba(255, 0, 128, 0.12)');
    haze.addColorStop(1, 'rgba(0, 240, 255, 0)');
    g.fillStyle = haze;
    g.fillRect(0, v.H * 0.8, v.W, v.H * 0.2);
  }
}
