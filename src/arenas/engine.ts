/**
 * 🏟️ PONGPONG Procedural Arena Engine
 *
 * Renders fully animated, asset-free 3D arenas behind the table tennis table.
 *
 * The legacy game draws the table sprite with a baked-in perspective. Solving that
 * perspective gives us a consistent pinhole camera (≈1.89m eye height, f≈690px),
 * which lets every arena place props on the floor / walls in true 3D perspective
 * that lines up with the table.
 *
 * Layer order per frame:
 *   drawBack   (dynamic: sky / space / ocean seen through windows)
 *   drawStatic (cached per canvas size: walls, floor, props — may contain transparent "windows")
 *   drawMid    (dynamic: lights, particles, animated props behind the table)
 *   ── legacy game renders table, enemy paddle, ball, net ──
 *   drawFront  (dynamic: rain, embers, fog — behind the local player's paddle)
 */

export const CAM_F = 690;
export const CAM_H = 1.886;
const STATIC_PAD = 90;

export interface ArenaView {
  W: number;
  H: number;
  /** Seconds since the arena started */
  t: number;
  /** Frame delta (seconds, clamped) */
  dt: number;
  /** Vertical camera shift applied to the whole background (legacy tableTop.offsetY * 25) */
  camY: number;
  /** Screen x of camera center */
  cx: number;
  /** Vanishing point (eye horizon) y */
  vpY: number;
  /** Floor ↔ back-wall junction y */
  jY: number;
  /** Far edge of the table (screen y) */
  tableTopY: number;
  f: number;
  hc: number;
  /** Distance (m) to the back wall / far boundary */
  zWall: number;
  /** Half-width (m) of the room at the back wall, adaptive to screen width */
  xWall: number;
  /** Live ball screen position (falls back to table center) */
  ballX: number;
  ballY: number;
}

export interface TableSkinInfo {
  w: number;
  h: number;
  /** Opaque horizontal span of the table sprite for each row */
  rows: Array<{ l: number; r: number }>;
}

export interface ArenaScene {
  readonly id: string;
  /** RGB of the table boundary / center lines */
  readonly tableLine: [number, number, number];
  /** Paints the table surface art (masked + shaded automatically by the engine) */
  paintTable(g: CanvasRenderingContext2D, info: TableSkinInfo): void;
  drawBack?(g: CanvasRenderingContext2D, v: ArenaView): void;
  drawStatic(g: CanvasRenderingContext2D, v: ArenaView): void;
  drawMid?(g: CanvasRenderingContext2D, v: ArenaView): void;
  drawFront?(g: CanvasRenderingContext2D, v: ArenaView): void;
  /** Called whenever the canvas size changes (re-seed particles) */
  reset?(v: ArenaView): void;
}

/* ------------------------------------------------------------------ */
/* Math & drawing helpers                                              */
/* ------------------------------------------------------------------ */

export function clamp(n: number, a: number, b: number): number {
  return n < a ? a : n > b ? b : n;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic PRNG (mulberry32) so static art is stable between frames */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function rgba(rgb: string, a: number): string {
  return `rgba(${rgb},${clamp(a, 0, 1).toFixed(3)})`;
}

/** Projects a world point (X lateral, Y up, Z depth in meters) to screen space */
export function proj(v: ArenaView, X: number, Y: number, Z: number) {
  const s = v.f / Math.max(0.05, Z);
  return { x: v.cx + X * s, y: v.vpY + (v.hc - Y) * s, s };
}

/** Screen y of the floor at depth Z */
export function floorY(v: ArenaView, Z: number): number {
  return v.vpY + (v.hc * v.f) / Math.max(0.05, Z);
}

/** Depth Z of the floor at screen y */
export function floorZ(v: ArenaView, y: number): number {
  return (v.hc * v.f) / Math.max(0.5, y - v.vpY);
}

/** Traces a quad lying on a vertical plane facing the camera (constant Z) */
export function pathWallRect(
  g: CanvasRenderingContext2D,
  v: ArenaView,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z: number
) {
  const a = proj(v, x0, y1, z);
  const b = proj(v, x1, y0, z);
  g.beginPath();
  g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
}

/** Traces a quad on the floor plane (Y = height) between X/Z bounds */
export function pathFloorQuad(
  g: CanvasRenderingContext2D,
  v: ArenaView,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y = 0
) {
  const p0 = proj(v, x0, y, z0);
  const p1 = proj(v, x1, y, z0);
  const p2 = proj(v, x1, y, z1);
  const p3 = proj(v, x0, y, z1);
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.lineTo(p2.x, p2.y);
  g.lineTo(p3.x, p3.y);
  g.closePath();
}

/** Traces a quad on a side wall (constant X) between Z and Y bounds */
export function pathSideQuad(
  g: CanvasRenderingContext2D,
  v: ArenaView,
  x: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number
) {
  const p0 = proj(v, x, y0, z0);
  const p1 = proj(v, x, y0, z1);
  const p2 = proj(v, x, y1, z1);
  const p3 = proj(v, x, y1, z0);
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.lineTo(p2.x, p2.y);
  g.lineTo(p3.x, p3.y);
  g.closePath();
}

/** Axis-aligned 3D box (visible faces only: front, top, inner side) */
export function drawBox(
  g: CanvasRenderingContext2D,
  v: ArenaView,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  front: string,
  top: string,
  side: string
) {
  // Inner side face (the one facing the screen center)
  const sideX = Math.abs(x0) < Math.abs(x1) ? x0 : x1;
  const towardCenter = (x0 + x1) / 2 > 0 ? x0 : x1;
  void sideX;
  g.fillStyle = side;
  pathSideQuad(g, v, towardCenter, z0, z1, y0, y1);
  g.fill();
  // Top face (visible since the camera is above most props)
  if (y1 < v.hc) {
    g.fillStyle = top;
    pathFloorQuad(g, v, x0, x1, z0, z1, y1);
    g.fill();
  }
  // Front face
  g.fillStyle = front;
  pathWallRect(g, v, x0, x1, y0, y1, z0);
  g.fill();
}

export function radialGlow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number
) {
  if (r <= 0 || alpha <= 0) return;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(rgb, alpha));
  grad.addColorStop(0.4, rgba(rgb, alpha * 0.45));
  grad.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export function vignette(g: CanvasRenderingContext2D, v: ArenaView, rgb: string, alpha: number) {
  const grad = g.createRadialGradient(v.W / 2, v.H * 0.55, v.H * 0.25, v.W / 2, v.H * 0.55, v.W * 0.75);
  grad.addColorStop(0, rgba(rgb, 0));
  grad.addColorStop(1, rgba(rgb, alpha));
  g.fillStyle = grad;
  g.fillRect(0, 0, v.W, v.H);
}

/* ------------------------------------------------------------------ */
/* View construction                                                   */
/* ------------------------------------------------------------------ */

export function buildView(
  W: number,
  H: number,
  tableTopY: number,
  camY: number,
  t: number,
  dt: number,
  ballX: number,
  ballY: number
): ArenaView {
  const vpY = tableTopY - 166 + camY;
  const jY = tableTopY - 20 + camY;
  const zWall = (CAM_H * CAM_F) / (jY - vpY);
  const xWall = (0.4 * W * zWall) / CAM_F;
  return {
    W,
    H,
    t,
    dt,
    camY,
    cx: W / 2,
    vpY,
    jY,
    tableTopY,
    f: CAM_F,
    hc: CAM_H,
    zWall,
    xWall: Math.max(3.2, xWall),
    ballX,
    ballY,
  };
}

/* ------------------------------------------------------------------ */
/* Table skin builder                                                  */
/* ------------------------------------------------------------------ */

/**
 * Re-skins the legacy table sprite: keeps its exact silhouette, lighting and net shadow,
 * swaps the felt for the arena's own surface art and recolors the boundary lines.
 */
export function buildTableSkin(
  scene: ArenaScene,
  img: CanvasImageSource,
  bX: number,
  bY: number,
  bW: number,
  bH: number
): HTMLCanvasElement | null {
  const base = makeCanvas(bW, bH);
  const bg = base.getContext('2d', { willReadFrequently: true });
  if (!bg) return null;
  bg.drawImage(img, bX, bY, bW, bH, 0, 0, bW, bH);

  let baseData: ImageData;
  try {
    baseData = bg.getImageData(0, 0, bW, bH);
  } catch {
    return null;
  }
  const px = baseData.data;

  // Per-row opaque spans + average felt luminance
  const rows: Array<{ l: number; r: number }> = [];
  let lumSum = 0;
  let lumCount = 0;
  for (let y = 0; y < bH; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < bW; x++) {
      const i = (y * bW + x) * 4;
      if (px[i + 3] > 128) {
        if (l < 0) l = x;
        r = x;
        const mn = Math.min(px[i], px[i + 1], px[i + 2]);
        if (mn < 170) {
          lumSum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          lumCount++;
        }
      }
    }
    rows.push({ l: Math.max(0, l), r: Math.max(0, r) });
  }
  const meanLum = lumCount > 0 ? lumSum / lumCount : 128;

  const skin = makeCanvas(bW, bH);
  const sg = skin.getContext('2d', { willReadFrequently: true });
  if (!sg) return null;
  scene.paintTable(sg, { w: bW, h: bH, rows });
  const skinData = sg.getImageData(0, 0, bW, bH).data;

  const out = bg.createImageData(bW, bH);
  const o = out.data;
  const [lr, lg, lb] = scene.tableLine;

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) continue;
    const r = px[i];
    const gC = px[i + 1];
    const b = px[i + 2];
    const mn = Math.min(r, gC, b);
    const lum = r * 0.299 + gC * 0.587 + b * 0.114;
    const shade = clamp(Math.pow(lum / meanLum, 0.75), 0.45, 1.35);
    const lineK = clamp((mn - 165) / 70, 0, 1);

    const sr = clamp(skinData[i] * shade, 0, 255);
    const sgC = clamp(skinData[i + 1] * shade, 0, 255);
    const sb = clamp(skinData[i + 2] * shade, 0, 255);

    o[i] = lerp(sr, lr, lineK);
    o[i + 1] = lerp(sgC, lg, lineK);
    o[i + 2] = lerp(sb, lb, lineK);
    o[i + 3] = a;
  }

  bg.clearRect(0, 0, bW, bH);
  bg.putImageData(out, 0, 0);
  return base;
}

/** Helper for table painters: clip to the table silhouette rows and fill */
export function tableSpanPath(g: CanvasRenderingContext2D, info: TableSkinInfo) {
  const { rows, h } = info;
  g.beginPath();
  g.moveTo(rows[0].l, 0);
  for (let y = 0; y < h; y++) g.lineTo(rows[y].l, y);
  for (let y = h - 1; y >= 0; y--) g.lineTo(rows[y].r + 1, y);
  g.closePath();
}

/** Maps normalized table coords (u across 0..1, v depth 0..1) to sprite pixels */
export function tableUV(info: TableSkinInfo, u: number, vv: number) {
  const y = clamp(Math.round(vv * (info.h - 1)), 0, info.h - 1);
  const row = info.rows[y];
  return { x: lerp(row.l, row.r, u), y };
}

/* ------------------------------------------------------------------ */
/* Renderer (owns caches, timing and scene instances)                  */
/* ------------------------------------------------------------------ */

export class ArenaRenderer {
  private scenes = new Map<string, ArenaScene>();
  private factories: Record<string, () => ArenaScene>;
  private staticKey = '';
  private staticCanvas: HTMLCanvasElement | null = null;
  private skinCache = new Map<string, HTMLCanvasElement | null>();
  private sizeKey = '';
  private t0 = performance.now();
  private lastNow = performance.now();
  private frameView: ArenaView | null = null;

  constructor(factories: Record<string, () => ArenaScene>) {
    this.factories = factories;
  }

  public has(sceneId: string | undefined): boolean {
    return Boolean(sceneId && this.factories[sceneId]);
  }

  private getScene(id: string): ArenaScene | null {
    let s = this.scenes.get(id);
    if (!s) {
      const factory = this.factories[id];
      if (!factory) return null;
      s = factory();
      this.scenes.set(id, s);
    }
    return s;
  }

  private readBall(W: number, H: number, tableTopY: number) {
    const ball = (window as any).ball;
    const bx = typeof ball?.x === 'number' && Number.isFinite(ball.x) ? ball.x : W / 2;
    const by = typeof ball?.y === 'number' && Number.isFinite(ball.y) ? ball.y : tableTopY + 100;
    return { bx, by };
  }

  private ensureStatic(scene: ArenaScene, W: number, H: number, tableTopY: number) {
    const key = `${scene.id}:${W}x${H}:${tableTopY}`;
    if (this.staticKey === key && this.staticCanvas) return;
    const v = buildView(W, H, tableTopY, 0, 0, 0, W / 2, tableTopY + 100);
    const c = makeCanvas(W, H + STATIC_PAD * 2);
    const g = c.getContext('2d');
    if (g) {
      g.translate(0, STATIC_PAD);
      scene.drawStatic(g, v);
    }
    this.staticCanvas = c;
    this.staticKey = key;
  }

  /** Full background render for an in-game frame. Returns false if the scene is unknown. */
  public renderBackground(
    ctx: CanvasRenderingContext2D,
    sceneId: string,
    W: number,
    H: number,
    offsetY: number
  ): boolean {
    const scene = this.getScene(sceneId);
    if (!scene) return false;

    const now = performance.now();
    const dt = clamp((now - this.lastNow) / 1000, 0, 0.05);
    this.lastNow = now;
    const t = (now - this.t0) / 1000;

    const tableTopY = H / 4;
    const camY = (Number.isFinite(offsetY) ? offsetY : 0) * 25;
    const { bx, by } = this.readBall(W, H, tableTopY);
    const v = buildView(W, H, tableTopY, camY, t, dt, bx, by);
    this.frameView = v;

    const sizeKey = `${sceneId}:${W}x${H}`;
    if (sizeKey !== this.sizeKey) {
      this.sizeKey = sizeKey;
      scene.reset?.(v);
    }

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    scene.drawBack?.(ctx, v);
    this.ensureStatic(scene, W, H, tableTopY);
    if (this.staticCanvas) {
      ctx.drawImage(this.staticCanvas, 0, -STATIC_PAD + camY);
    }
    scene.drawMid?.(ctx, v);
    ctx.restore();
    return true;
  }

  public renderForeground(ctx: CanvasRenderingContext2D, sceneId: string) {
    const scene = this.getScene(sceneId);
    const v = this.frameView;
    if (!scene || !v || !scene.drawFront) return;
    ctx.save();
    scene.drawFront(ctx, v);
    ctx.restore();
  }

  public getTableSkin(
    sceneId: string,
    img: CanvasImageSource,
    bX: number,
    bY: number,
    bW: number,
    bH: number
  ): HTMLCanvasElement | null {
    const key = `${sceneId}:${bX}:${bY}:${bW}:${bH}`;
    if (this.skinCache.has(key)) return this.skinCache.get(key) || null;
    const scene = this.getScene(sceneId);
    if (!scene) return null;
    const skin = buildTableSkin(scene, img, bX, bY, bW, bH);
    this.skinCache.set(key, skin);
    return skin;
  }

  /**
   * Paints a still frame of an arena for lobby stage-select previews.
   * `drawTable` is invoked between the mid and front layers.
   */
  public renderSnapshot(
    g: CanvasRenderingContext2D,
    sceneId: string,
    w: number,
    h: number,
    tableTopY: number,
    drawTable: () => void
  ): boolean {
    const scene = this.factories[sceneId]?.();
    if (!scene) return false;
    const t = 2.4;
    const v = buildView(w, h, tableTopY, 0, t, 1 / 60, w / 2, tableTopY + 120);
    scene.reset?.(v);
    // Warm up particles a little so previews look alive
    for (let i = 0; i < 40; i++) {
      const warm = { ...v, t: t - (40 - i) / 60, dt: 1 / 60 };
      scene.drawMid && g.save();
      if (scene.drawMid) {
        scene.drawMid(g, warm);
        g.restore();
      }
    }
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    scene.drawBack?.(g, v);
    g.save();
    scene.drawStatic(g, v);
    g.restore();
    g.save();
    scene.drawMid?.(g, v);
    g.restore();
    drawTable();
    g.save();
    scene.drawFront?.(g, v);
    g.restore();
    return true;
  }
}
