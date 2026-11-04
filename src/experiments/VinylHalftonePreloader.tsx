"use client"

// Vinyl Halftone Preloader: a record-sleeve loading gate for a portfolio. The
// page is printed in two inks: a giant record sits on the left with your name
// on its label, and a halftone starburst throbs on the right in time with the
// BPM. The record spins up from a standstill to 33⅓ as the load climbs, the
// needle (a pale groove) walks inward, and the stages step down the diagonal
// like a game's pause menu, each lighting up in turn. Grab the record to
// scratch it. At 100 the last stage becomes the way in: ink floods out of the
// burst, then the dots shrink away and reveal your page underneath.
//
// One file, React only. The halftone is one WebGL fragment shader held to a
// pixel budget (a CSS dot screen stands in where WebGL is missing). Every rule
// in the scoped <style> is .vhp- prefixed. Only the two web fonts are fetched,
// and the fallback stacks keep the look without them.

import * as React from "react"

export type VinylPreset = "rhythm" | "cobalt" | "citrus" | "newsprint"

export interface VinylPalette {
  /** The paper: the label, and everything the ink does not cover. */
  paper: string
  /** The ink: vinyl, burst, label type and the resting stages. */
  ink: string
  /** Fill of the lit stage. */
  glow: string
  /** The extruded edge behind the lit stage. */
  edge: string
  /** The specks that twinkle in the ink. */
  spark: string
}

export interface VinylHalftonePreloaderProps {
  /** Revealed when the gate lifts. With `loop` it shows between runs. */
  children?: React.ReactNode
  /** Showcase mode: replays forever and never fires onComplete. */
  loop?: boolean
  /** Whether to show the interactive turntable spindle mute button. Defaults to true. */
  showMuteButton?: boolean
  /** Real loading progress, 0–100. Leave undefined to simulate over `durationMs`. */
  progress?: number
  /** Length of the simulated load. Defaults to 4200ms. */
  durationMs?: number
  /** "auto" lifts the gate a beat after 100; "click" waits for the last stage to be pressed. */
  enter?: "auto" | "click"
  /** Colour preset. Defaults to "rhythm" (hot pink on oxblood). */
  preset?: VinylPreset
  /** Colour overrides, merged over the preset. Hex colours (#rgb or #rrggbb). */
  palette?: { paper?: string; ink?: string; glow?: string; edge?: string; spark?: string }
  /** First line on the label. */
  title?: string
  /** Second, smaller line on the label. */
  subtitle?: string
  /** The big word on the label while loading. */
  loadingWord?: string
  /** The big word on the label once loaded. */
  readyWord?: string
  /** Small uppercase lines at the foot of the label. */
  credits?: string[]
  /** Text that runs around the spinning label edge. */
  ringText?: string
  /** The stages down the diagonal. The last one is the way in. */
  stages?: string[]
  /** Tempo of the burst's pulse. Defaults to 120. */
  bpm?: number
  /** Corner line that tells people they can scratch. Empty string hides it. */
  hint?: string
  /** Display face for the stages. The first family is the one fontHref loads. */
  displayFamily?: string
  /** Face for the label type. */
  textFamily?: string
  /** Stylesheet that loads the faces. null to load nothing (bring your own). */
  fontHref?: string | null
  /** Root height. A definite length, never a percentage. */
  height?: string
  /** Fired once, after the gate has lifted. */
  onComplete?: () => void
  /** Fired when any menu stage is clicked (index, stageLabel). */
  onSelectStage?: (index: number, stageLabel: string) => void
  /** Custom logo or branding element to render on the left vinyl label. */
  customLogo?: React.ReactNode
  /** When true, functions as an active interactive home menu (all stages clickable, 100% ready immediately). */
  interactiveMenu?: boolean
  /** When true, hides the 4 diagonal stage buttons and expands the black starburst to host the Pre-Game Lobby. */
  lobbyOpen?: boolean
  /** Optional callback when user submits a 6-character room code from the home screen quick-join bar. */
  onJoinRoomCode?: (code: string) => void
  /** Optional initial room code for the quick-join input. */
  initialJoinCode?: string
  /** Extra root class names. */
  className?: string
}

const PRESETS: VinylPresetMap = {
  rhythm: { paper: "#f2687c", ink: "#1d070b", glow: "#fff6c4", edge: "#d63250", spark: "#ffffff" },
  cobalt: { paper: "#5370ff", ink: "#05081f", glow: "#f2f5ff", edge: "#1f2fc4", spark: "#dfe6ff" },
  citrus: { paper: "#ffb21a", ink: "#1c0e00", glow: "#fffbea", edge: "#e2531a", spark: "#fff8dc" },
  newsprint: { paper: "#ebe5d8", ink: "#151311", glow: "#ffffff", edge: "#e3402a", spark: "#fff7e6" },
}

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@500;600;800&display=swap"
const DISPLAY_STACK = 'Anton, "Bebas Neue", Oswald, Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'
const TEXT_STACK = 'Archivo, "Helvetica Neue", Arial, "Segoe UI", sans-serif'

const INTRO_MS = 1300
const HOLD_MS = 1100
const FLOOD_MS = 750
const REVEAL_MS = 1050
const LOOP_REST_MS = 2600

// #region logic
// Pure helpers, lifted out and executed by tests/vinyl-halftone-preloader.test.mjs.

export function vhpClamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * The simulated load at time fraction t ∈ [0, 1], as a percentage. Eased, with
 * a couple of stalls so it reads like real assets arriving, and it never runs
 * backwards. Exactly 0 at t = 0 and exactly 100 at t = 1.
 */
export function vhpSimulated(t: number) {
  const k = vhpClamp01(t)
  const ease = 1 - Math.pow(1 - k, 2.2)
  const stall = 0.045 * Math.sin(k * Math.PI * 4) * Math.sin(k * Math.PI)
  const v = (ease - stall * (1 - k)) * 100
  return k >= 1 ? 100 : Math.max(0, Math.min(99.9, v))
}

/** Which stage is lit at a percentage. The last stage only lights at 100. */
export function vhpStage(pct: number, count: number) {
  const n = Math.max(1, Math.floor(count))
  if (n === 1) return 0
  if (pct >= 100) return n - 1
  return Math.max(0, Math.min(n - 2, Math.floor((Math.max(0, pct) / 100) * (n - 1))))
}

/** Platter speed in RPM: gentle, relaxed turntable rotation (~5.5 RPM, ~1 revolution every 11 seconds). */
export function vhpRpm(pct: number) {
  const k = vhpClamp01(pct / 40)
  return 5.5 * (1 - Math.pow(1 - k, 3))
}

/** Radius of the needle's groove: walks from the outer edge to the label. */
export function vhpNeedle(pct: number, rl: number, rv: number) {
  const band = rv - rl
  return rv - band * 0.1 - band * 0.8 * vhpClamp01(pct / 100)
}

/** Beat envelope in [0, 1]: a hard hit on every beat that decays before the next. */
export function vhpBeat(ms: number, bpm: number) {
  const b = Math.max(30, Math.min(240, bpm || 120))
  const phase = ((ms / 60000) * b) % 1
  return Math.exp(-phase * 5.5)
}

/** Shortest signed difference between two angles in radians. */
export function vhpAngleDelta(a: number, b: number) {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Zero-padded three-digit count. */
export function vhpPad(pct: number) {
  const n = Math.max(0, Math.min(100, Math.floor(pct)))
  return (n < 10 ? "00" : n < 100 ? "0" : "") + n
}

/** #rgb / #rrggbb to 0–1 floats. Anything else falls back so the art never goes black. */
export function vhpRGB(c: string, fallback: number[]) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || "").trim())
  if (!m) return fallback
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

/**
 * Where everything sits for a w × h stage, in CSS px. Landscape puts the record
 * on the left with the stages stepping down the right; portrait hangs the
 * record from the top and stacks the stages under it.
 */
export function vhpLayout(w: number, h: number, count: number) {
  const W = Math.max(1, w)
  const H = Math.max(1, h)
  const steps = Math.max(1, count - 1)
  const portrait = W < H * 0.9
  if (!portrait) {
    const u = Math.min(H, W * 0.6)
    const sx = Math.max(W * 0.05, u * 0.07)
    const sy = H * 0.5
    const rl = u * 0.6
    const rv = u * 0.8
    const bx = Math.max(W * 0.66, sx + rv + u * 0.18)
    const by = H * 0.52
    // Responsive font size for punchy display
    const fs = Math.min(68, Math.max(34, u * 0.08))
    // Width estimate for the longest stage name ("4V4 MAYHEM ▶")
    const estimatedLabelW = fs * 4.6
    // Horizontal step between stages
    const dx = Math.max(18, Math.min(u * 0.04, (W - bx - estimatedLabelW * 0.5 - 40) / steps))
    // Center the entire 4-stage diagonal staircase right over the black splash center `bx`
    const menuCenterOffsetX = (steps * dx + estimatedLabelW) * 0.48
    // Ensure mx never overlaps the turntable platter rim (sx + rv)
    const minSafeMx = sx + rv + Math.max(24, u * 0.05)
    const maxSafeMx = W - estimatedLabelW - steps * dx - 45
    const mx = Math.max(minSafeMx, Math.min(maxSafeMx, bx - menuCenterOffsetX))

    // Vertical spacing and centering over `by`
    const dy = Math.min(u * 0.095, (H * 0.4) / steps)
    const my = by - (steps * dy + fs * 0.5) * 0.5
    return {
      portrait, u, sx, sy, rl, rv, hole: u * 0.036, bx, by, br: u * 0.37,
      fs, mx, my, dx, dy,
      tx: sx + u * 0.15, ty: sy, tw: rl - u * 0.18, ts: u * 0.034, cell: Math.max(5, Math.min(10, u * 0.0115)),
    }
  }
  const u = Math.min(W, H * 0.6)
  const sx = W * 0.5
  const sy = H * 0.055
  const rl = u * 0.78
  const rv = u * 1.0
  const by = Math.max(H * 0.69, sy + rv + u * 0.17)
  const fs = Math.min(50, Math.max(28, u * 0.09))
  const estimatedLabelW = fs * 4.6
  const dx = Math.max(10, Math.min(u * 0.035, (W - estimatedLabelW - 30) / steps))
  const mx = Math.max(16, (W - estimatedLabelW - steps * dx) * 0.5)
  const dy = Math.min(u * 0.11, (H * 0.3) / steps)
  const my = by - (steps * dy + fs) * 0.5
  return {
    portrait, u, sx, sy, rl, rv, hole: u * 0.045, bx: W * 0.5, by, br: u * 0.42,
    fs, mx, my, dx, dy,
    tx: sx, ty: sy + rl * 0.56, tw: rl * 1.3, ts: u * 0.045, cell: Math.max(4.5, Math.min(9, u * 0.016)),
  }
}
// #endregion

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"

// Field of ink coverage across the page, sampled once per halftone cell and
// turned into dots on a 45° screen. Three samples, nudged apart, print the red
// and blue plates slightly off register, as a cheap press would.
const FRAG = [
  "precision highp float;",
  "uniform vec2 uRes;uniform float uTime,uCell,uU,uIntro,uE1,uE2,uBeat,uEnergy,uNeedle,uScratch,uHole,uPx;",
  "uniform vec2 uSpin,uRec;uniform vec3 uBurst,uPaper,uInk,uSpark;",
  "float sat(float x){return clamp(x,0.,1.);}",
  "float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
  "float field(vec2 p){",
  " float u=uU;vec2 d=p-uSpin;float r=length(d);float a=atan(d.y,d.x);float soft=.012*u;",
  " float disc=smoothstep(uRec.x-soft,uRec.x+soft,r)*(1.-smoothstep(uRec.y-soft*1.6,uRec.y+soft*1.6,r));",
  " float zone=sat((r-uRec.x)/(uRec.y-uRec.x));",
  " float groove=.8+.2*sin(r/uCell*1.9)*sin(zone*31.);",
  " float sheen=pow(abs(cos(a-.8)),12.)*sin(zone*3.14159);",
  " float vinyl=disc*groove*(1.-.62*sheen);",
  " float nd=(r-uNeedle)/(.0055*u+uPx);vinyl*=1.-.9*exp(-nd*nd)*disc;",
  " float hole=0.;",
  " vec2 q=p-uBurst.xy;float rr=length(q);float th=atan(q.y,q.x);float t=uTime;",
  " float s1=pow(.5+.5*sin(th*9.+t*.35),3.);float s2=pow(.5+.5*sin(th*14.-t*.55+1.3),6.);float s3=.5+.5*sin(th*37.+t*1.7);",
  " float R=uBurst.z*(1.+uEnergy*(.2*s1+.24*s2+.04*s3)+.07*uBeat*uEnergy+.1*uScratch*s3);",
  " float bs=.06*u;float burst=1.-smoothstep(R-bs,R+bs*.8,rr);",
  " float rays=pow(.5+.5*sin(th*19.+2.*sin(th*3.+t*.2)),30.)*(1.-smoothstep(R,R*1.5,rr))*smoothstep(R*.75,R,rr);",
  " burst=max(burst,rays*.75*uEnergy);",
  " burst*=smoothstep(uRec.x-soft,uRec.x+soft*4.,r);",
  " vec2 nc=p/uRes-.5;nc.x*=uRes.x/uRes.y;",
  " float tone=.14*smoothstep(.45,1.05,length(nc))*smoothstep(uRec.x,uRec.x+soft*5.,r);",
  " float f=max(max(vinyl,hole),max(burst,tone));",
  " float ir=mix(-.3*u,length(uRes)*1.15,uIntro);f*=1.-smoothstep(ir-.35*u,ir,r);",
  " float fr=mix(-.3*u,length(uRes)*1.25,uE1);f=max(f,1.-smoothstep(fr-.3*u,fr,rr));",
  " return sat(f);",
  "}",
  "float cover(vec2 p){",
  " vec2 g=mat2(.70710678,-.70710678,.70710678,.70710678)*p;",
  " vec2 cc=(floor(g/uCell)+.5)*uCell;",
  " vec2 c=mat2(.70710678,.70710678,-.70710678,.70710678)*cc;",
  " float f;",
  " if(uE2>0.){float rv=mix(-.45*uU,length(uRes)*1.2,uE2);f=smoothstep(rv-.45*uU,rv,length(c-uBurst.xy));}",
  " else f=field(c);",
  " float rad=sqrt(f)*uCell*.8;float dist=length(g-cc);",
  " return max(1.-smoothstep(rad-uPx*.9,rad+uPx*.9,dist),step(.985,f));",
  "}",
  "void main(){",
  " vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);",
  " vec2 o=vec2(1.,.6)*uPx*(1.1+5.*uScratch);",
  " float cr=cover(p+o);float cg=cover(p);float cb=cover(p-o);",
  " if(uE2>0.){gl_FragColor=vec4(uInk*cg,cg);return;}",
  " vec3 col=vec3(mix(uPaper.r,uInk.r,cr),mix(uPaper.g,uInk.g,cg),mix(uPaper.b,uInk.b,cb));",
  " float hr=length(p-uSpin);float hm=1.-smoothstep(uHole-uPx,uHole+uPx,hr);",
  " hm=max(hm,(1.-smoothstep(uPx*.6,uPx*1.4,abs(hr-uHole*1.9)))*.55);",
  " col=mix(col,uInk,hm*uIntro);",
  " float sc=uU*.085;vec2 sp=p/sc;sp.y+=uTime*.12;vec2 id=floor(sp);vec2 fr=fract(sp);",
  " float h=hash(id);vec2 pos=vec2(hash(id+3.1),hash(id+7.7))*.8+.1;",
  " float tw=pow(.5+.5*sin(uTime*(1.4+h*3.)+h*40.),6.)*step(.6,h);",
  " float sz=(.9+1.4*h)*uPx/sc;",
  " float s=step(abs(fr.x-pos.x),sz)*step(abs(fr.y-pos.y),sz)*tw*cg*(1.-uE1);",
  " col=mix(col,uSpark,s);",
  " col+=(hash(p+fract(uTime*7.)*91.)-.5)*.045;",
  " gl_FragColor=vec4(col,1.);",
  "}",
].join("\n")

const VHP_CSS = `
.vhp-root { position: relative; width: 100%; overflow: hidden; isolation: isolate; }
.vhp-gate {
  position: absolute; inset: 0; z-index: 5; overflow: hidden; background: var(--vhp-paper); color: var(--vhp-ink);
  -webkit-font-smoothing: antialiased; touch-action: none; user-select: none; -webkit-user-select: none;
}
.vhp-gate[data-gl="true"][data-phase="exit"] { background: transparent; }
.vhp-gate[data-fade="true"] { opacity: 0; transition: opacity 450ms ease; }
.vhp-gate[data-scratch="true"] { cursor: grabbing; }
.vhp-canvas { position: absolute; left: 0; top: 0; display: block; max-width: none; pointer-events: none; }
.vhp-dots {
  position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, var(--vhp-ink) 0 46%, transparent 49%);
  background-size: var(--vhp-cell) var(--vhp-cell);
}
.vhp-ring { position: absolute; pointer-events: none; overflow: visible; max-width: none; animation: vhp-fade 900ms 200ms both; }
.vhp-ring text { font-family: var(--vhp-text); font-weight: 800; letter-spacing: .32em; text-transform: uppercase; fill: var(--vhp-ink); }
.vhp-label {
  position: absolute; margin: 0; padding: 0; list-style: none; line-height: 1; color: var(--vhp-ink);
  font-family: var(--vhp-text); transform: translateY(-50%); transition: opacity 500ms ease, transform 700ms cubic-bezier(.7,0,.3,1);
}
.vhp-label[data-align="center"] { transform: translate(-50%, -50%); text-align: center; }
.vhp-label > * { display: block; margin: 0; text-shadow: .05em .05em 0 var(--vhp-shade); animation: vhp-rise 900ms cubic-bezier(.2,.8,.2,1) both; }
.vhp-retro-brand {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  width: max-content; max-width: clamp(280px, 46vw, 480px);
  animation: vhp-rise 900ms cubic-bezier(.2,.8,.2,1) both;
}
.vhp-label[data-align="center"] .vhp-retro-brand { align-items: center; text-align: center; }
.vhp-retro-badge {
  display: inline-flex; align-items: center; gap: 5px; background: #00f0ff; color: #0b061c;
  border: 2px solid #0b061c; box-shadow: 2px 2px 0px #0b061c; padding: 3px 9px;
  font-family: var(--vhp-text), 'Archivo', sans-serif; font-size: clamp(9px, 1.1vmin, 11px); font-weight: 800;
  letter-spacing: 0.16em; text-transform: uppercase; border-radius: 2px;
  transform: skewX(-7deg) rotate(-3deg);
}
.vhp-retro-title {
  font-family: var(--vhp-display), 'Anton', sans-serif; font-size: clamp(38px, 6.2vmin, 66px);
  font-weight: 400; line-height: 0.88; letter-spacing: 0.02em; text-transform: uppercase;
  color: #ffffff;
  transform: skewX(-7deg) rotate(-3deg);
  text-shadow:
    -.014em -.014em 0 #0b061c, .014em -.014em 0 #0b061c, -.014em .014em 0 #0b061c, .014em .014em 0 #0b061c,
    .022em .022em 0 #ff007f, .04em .04em 0 #ff007f, .058em .058em 0 #0b061c, .076em .076em 0 #000000,
    0 0 .32em rgba(0, 240, 255, 0.4);
  margin: 4px 0 2px 0;
}
.vhp-retro-sub {
  font-family: var(--vhp-text), 'Archivo', sans-serif; font-size: clamp(9.5px, 1.2vmin, 12px);
  font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #0b061c;
  transform: skewX(-7deg) rotate(-3deg);
  text-shadow: .04em .04em 0 rgba(255, 255, 255, 0.6);
  margin-top: 1px;
}
.vhp-retro-meta {
  margin-top: 8px; display: flex; flex-direction: column; gap: 3px;
  font-family: var(--vhp-text), 'Archivo', sans-serif; font-size: clamp(8.5px, 1.05vmin, 10.5px);
  font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #00f0ff; line-height: 1.3;
}
.vhp-retro-meta span {
  background: #0b061c; padding: 3px 9px; border-radius: 999px; display: inline-block; width: fit-content;
  border: 1.5px solid rgba(0, 240, 255, 0.5); box-shadow: 2px 2px 0px #0b061c;
}
.vhp-title { font-weight: 600; font-size: 1em; letter-spacing: -.01em; animation-delay: 380ms !important; }
.vhp-sub { font-weight: 600; font-size: .66em; margin-top: .3em !important; opacity: .92; animation-delay: 460ms !important; }
.vhp-big { position: relative; font-weight: 600; font-size: 2.65em; letter-spacing: -.035em; line-height: .95; margin-top: .06em !important; white-space: nowrap; animation-delay: 540ms !important; }
.vhp-big > b { display: inline-block; font-weight: inherit; }
.vhp-big > b[data-ready="true"] { animation: vhp-pop 650ms cubic-bezier(.2,1.6,.4,1) both; }
.vhp-count {
  display: inline-block; vertical-align: top; margin-left: .32em; font-size: .24em; font-weight: 800; letter-spacing: .06em;
  font-variant-numeric: tabular-nums; line-height: 1; transform: translateY(.45em); text-shadow: none;
}
.vhp-cred { font-weight: 800; font-size: .5em; letter-spacing: .02em; text-transform: uppercase; line-height: 1.32; margin-top: .55em !important; animation-delay: 620ms !important; }
.vhp-label[data-align="center"] .vhp-count { position: absolute; left: 100%; top: 0; }
.vhp-menu { position: absolute; inset: 0; margin: 0; padding: 0; list-style: none; pointer-events: none; }
.vhp-stage { position: absolute; left: 0; top: 0; animation: vhp-slide 900ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(520ms + var(--i) * 110ms); }
.vhp-item {
  all: unset; box-sizing: border-box; position: relative; display: block; pointer-events: auto; cursor: pointer;
  font-family: var(--vhp-display); font-weight: 400; line-height: .9; letter-spacing: .02em; text-transform: uppercase; white-space: nowrap;
  color: #ffffff;
  text-shadow:
    -.014em -.014em 0 #0b061c, .014em -.014em 0 #0b061c, -.014em .014em 0 #0b061c, .014em .014em 0 #0b061c,
    .022em .022em 0 #ff007f, .038em .038em 0 #ff007f, .054em .054em 0 #0b061c, .07em .07em 0 #000000;
  transform: skewX(-7deg) rotate(-3deg) translateX(var(--vhp-nudge, 0px));
  transition: transform 280ms cubic-bezier(.2,.9,.2,1), opacity 250ms ease, color 200ms ease, text-shadow 200ms ease;
  opacity: 0.95;
}
.vhp-item[data-state="next"] { opacity: .75; }
.vhp-item[data-state="done"] { opacity: .95; color: #ffffff; }
.vhp-item:hover {
  --vhp-nudge: .18em; opacity: 1; cursor: pointer;
  color: #ffe600;
  text-shadow:
    -.014em -.014em 0 #0b061c, .014em -.014em 0 #0b061c, -.014em .014em 0 #0b061c, .014em .014em 0 #0b061c,
    .024em .024em 0 #00f0ff, .042em .042em 0 #00f0ff, .06em .06em 0 #0b061c,
    0 0 .28em rgba(255, 230, 0, 0.55);
}
.vhp-item[data-state="on"] {
  color: #00f0ff; opacity: 1; z-index: 2;
  transform: skewX(-7deg) rotate(-3deg) translateX(var(--vhp-nudge, 0px)) scale(calc(1.05 + var(--vhp-beat, 0) * .035));
  text-shadow:
    -.014em -.014em 0 #0b061c, .014em -.014em 0 #0b061c, -.014em .014em 0 #0b061c, .014em .014em 0 #0b061c,
    .022em .022em 0 #ff007f, .038em .038em 0 #ff007f, .054em .054em 0 #ff007f, .072em .072em 0 #0b061c,
    0 0 .35em rgba(0, 240, 255, 0.75);
}
.vhp-item[data-state="on"]:hover {
  color: #ffffff;
  text-shadow:
    -.014em -.014em 0 #0b061c, .014em -.014em 0 #0b061c, -.014em .014em 0 #0b061c, .014em .014em 0 #0b061c,
    .024em .024em 0 #00f0ff, .044em .044em 0 #00f0ff, .065em .065em 0 #ff007f,
    0 0 .42em rgba(0, 240, 255, 0.9);
}
.vhp-item[data-state="on"]::before, .vhp-item[data-state="on"]::after, .vhp-item:hover::before, .vhp-item:hover::after {
  content: attr(data-text); position: absolute; left: 0; top: 0; pointer-events: none; text-shadow: none; mix-blend-mode: screen;
}
.vhp-item[data-state="on"]::before, .vhp-item:hover::before { color: #ff2a55; opacity: .55; transform: translate(calc(-.02em - var(--vhp-beat, 0) * .03em), .006em); }
.vhp-item[data-state="on"]::after, .vhp-item:hover::after { color: #2ae4ff; opacity: .4; transform: translate(calc(.02em + var(--vhp-beat, 0) * .03em), -.006em); }
.vhp-item[data-state="on"]::before, .vhp-item[data-state="on"]::after { clip-path: inset(var(--vhp-slice, 40%) 0 calc(100% - var(--vhp-slice, 40%) - 18%) 0); }
.vhp-item:enabled { cursor: pointer; }
.vhp-item:focus-visible { outline: 2px solid var(--vhp-glow); outline-offset: .12em; }
.vhp-item .vhp-play {
  display: inline-block; font-size: .52em; margin-left: .35em; vertical-align: .48em;
  color: #00f0ff; text-shadow: 1px 1px 0 #000, 2px 2px 0 #ff007f;
  transition: transform 260ms cubic-bezier(.2,.9,.2,1), color 200ms ease;
}
.vhp-item[data-state="on"] .vhp-play {
  color: #00f0ff; text-shadow: 1px 1px 0 #000, 2px 2px 0 #ff007f, 0 0 10px #00f0ff;
  transform: translateX(.22em);
}
.vhp-item:hover .vhp-play {
  transform: translateX(.32em) scale(1.15); color: #ffe600;
  text-shadow: 1px 1px 0 #000, 2px 2px 0 #00f0ff, 0 0 10px #ffe600;
}
.vhp-hint {
  position: absolute; right: clamp(16px, 2.6vmin, 34px); bottom: clamp(14px, 2.4vmin, 30px); margin: 0;
  font-family: var(--vhp-text); font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
  color: var(--vhp-paper); background: var(--vhp-ink); padding: .85em 1.3em .8em 1.1em; border-radius: 999px;
  animation: vhp-fade 900ms 1400ms both; transition: opacity 400ms ease;
}
.vhp-hint > i { display: inline-block; width: .7em; height: .7em; margin-right: .7em; border-radius: 50%; background: currentColor; vertical-align: -.02em; animation: vhp-blink 1s steps(2, start) infinite; }
.vhp-gate[data-phase="exit"] { pointer-events: none !important; }
.vhp-gate[data-phase="exit"] .vhp-label { opacity: 0; transform: translate(-6%, -50%) scale(.96); }
.vhp-gate[data-phase="exit"] .vhp-label[data-align="center"] { transform: translate(-50%, -54%) scale(.96); }
.vhp-gate[data-phase="exit"] .vhp-ring, .vhp-gate[data-phase="exit"] .vhp-hint, .vhp-gate[data-phase="exit"] .vhp-join-bar { opacity: 0; transition: opacity 400ms ease; pointer-events: none; }
.vhp-gate[data-phase="exit"] .vhp-spindle-mute { opacity: 0; transform: translate(-50%, -50%) scale(0.65); transition: opacity 400ms ease, transform 400ms ease; pointer-events: none; }
.vhp-gate[data-phase="exit"] .vhp-stage { animation: vhp-leave 600ms cubic-bezier(.7,0,.84,0) both; animation-delay: calc(var(--i) * 60ms); }
.vhp-gate[data-lobby="true"] .vhp-stage {
  opacity: 0; pointer-events: none; transform: translate(2.2em, 0.5em) scale(0.92);
  transition: opacity 260ms ease, transform 320ms cubic-bezier(.7,0,.84,0);
}
.vhp-gate[data-lobby="true"] .vhp-join-bar {
  opacity: 0; pointer-events: none; transform: skewX(-7deg) rotate(-3deg) translateY(18px);
}
.vhp-join-bar {
  position: absolute; display: inline-flex; align-items: center; gap: 8px;
  background: rgba(11, 6, 28, 0.92); border: 2px solid #ffe600; border-radius: 8px;
  padding: 6px 10px; box-shadow: 4px 4px 0px #ff007f, 7px 7px 0px #000;
  transform: skewX(-7deg) rotate(-3deg); pointer-events: auto; z-index: 8;
  transition: opacity 260ms ease, transform 320ms cubic-bezier(.2,.9,.2,1);
  animation: vhp-slide 900ms 960ms cubic-bezier(.16,1,.3,1) both;
}
.vhp-join-label {
  font-family: var(--vhp-text), 'Archivo', sans-serif; font-size: 11px; font-weight: 800;
  letter-spacing: 0.1em; color: #ffe600; white-space: nowrap;
}
.vhp-join-input {
  width: 110px; background: #1a0e36; border: 2px solid #00f0ff; border-radius: 5px;
  padding: 5px 8px; color: #ffffff; font-family: var(--vhp-text), 'Archivo', monospace;
  font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
  text-align: center; outline: none; user-select: text; -webkit-user-select: text;
}
.vhp-join-input:focus { border-color: #ffe600; box-shadow: 0 0 10px rgba(255, 230, 0, 0.5); }
.vhp-join-btn {
  background: #00f0ff; color: #0b061c; border: 2px solid #000; border-radius: 5px;
  padding: 5px 12px; font-family: var(--vhp-display), 'Anton', sans-serif; font-size: 14px;
  letter-spacing: 0.06em; cursor: pointer; box-shadow: 2px 2px 0px #ff007f;
  transition: transform 150ms ease, background 150ms ease;
}
.vhp-join-btn:hover { background: #ffe600; transform: translate(-1px, -1px); }
.vhp-spindle-mute {
  position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center;
  border-radius: 50%; cursor: pointer; z-index: 12; pointer-events: auto; border: none; padding: 0; outline: none;
  background: radial-gradient(circle at 36% 36%, #2d1847 0%, #0b061c 65%, #05020c 100%);
  box-shadow:
    0 0 0 2px #0b061c,
    0 0 0 3.5px #ffe600,
    0 4px 14px rgba(0, 0, 0, 0.85),
    inset 0 2px 4px rgba(255, 255, 255, 0.22),
    inset 0 -2px 6px rgba(0, 0, 0, 0.9);
  transition: transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1), box-shadow 220ms ease, background 220ms ease;
  animation: vhp-pop 800ms 350ms cubic-bezier(0.2, 1.4, 0.3, 1) both;
}
.vhp-spindle-mute:hover {
  transform: translate(-50%, -50%) scale(1.12);
  box-shadow:
    0 0 0 2px #0b061c,
    0 0 0 3.5px #00f0ff,
    0 0 16px rgba(0, 240, 255, 0.8),
    0 6px 18px rgba(0, 0, 0, 0.9),
    inset 0 0 10px rgba(0, 240, 255, 0.35);
}
.vhp-spindle-mute:active { transform: translate(-50%, -50%) scale(0.94); }
.vhp-spindle-mute[data-muted="true"] {
  background: radial-gradient(circle at 36% 36%, #450d1a 0%, #170409 65%, #080103 100%);
  box-shadow:
    0 0 0 2px #0b061c,
    0 0 0 3.5px #ff0055,
    0 0 10px rgba(255, 0, 85, 0.5),
    0 4px 14px rgba(0, 0, 0, 0.85),
    inset 0 1px 3px rgba(255, 100, 150, 0.3),
    inset 0 -2px 6px rgba(0, 0, 0, 0.95);
}
.vhp-spindle-mute[data-muted="true"]:hover {
  box-shadow:
    0 0 0 2px #0b061c,
    0 0 0 3.5px #ff2a75,
    0 0 20px rgba(255, 0, 85, 0.9),
    0 6px 18px rgba(0, 0, 0, 0.9),
    inset 0 0 12px rgba(255, 0, 85, 0.4);
}
.vhp-spindle-icon {
  width: 52%; height: 52%; display: block; pointer-events: none;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8)); transition: transform 200ms ease;
}
.vhp-spindle-mute:hover .vhp-spindle-icon { transform: scale(1.08); }
.vhp-spindle-tooltip {
  position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%) translateY(4px);
  pointer-events: none; opacity: 0; white-space: nowrap; background: #0b061c; color: #ffe600;
  border: 1.5px solid #ffe600; box-shadow: 2px 2px 0px #000; font-family: 'Press Start 2P', monospace;
  font-size: 8px; letter-spacing: 0.08em; padding: 4px 8px; border-radius: 3px;
  transition: opacity 200ms ease, transform 200ms ease; z-index: 20;
}
.vhp-spindle-mute:hover .vhp-spindle-tooltip { opacity: 1; transform: translateX(-50%) translateY(0); }
.vhp-spindle-mute[data-muted="true"] .vhp-spindle-tooltip { color: #ff0055; border-color: #ff0055; }
.vhp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes vhp-fade { from { opacity: 0; } }
@keyframes vhp-rise { from { opacity: 0; transform: translateY(.6em); } }
@keyframes vhp-slide { from { opacity: 0; transform: translate(1.4em, -.5em); } }
@keyframes vhp-leave { to { opacity: 0; transform: translate(2.2em, .6em); } }
@keyframes vhp-pop { from { opacity: 0; transform: scale(.7) rotate(-4deg); } }
@keyframes vhp-blink { to { opacity: .15; } }
@media (prefers-reduced-motion: reduce) {
  .vhp-label > *, .vhp-stage, .vhp-ring, .vhp-hint, .vhp-big > b[data-ready="true"] { animation: none !important; }
  .vhp-item, .vhp-label { transition: none; }
  .vhp-item[data-state="on"] { transform: skewX(-7deg) rotate(-3deg) scale(1.04); }
  .vhp-item::before, .vhp-item::after { display: none; }
  .vhp-hint > i { animation: none; }
}
`

type Phase = "load" | "ready" | "exit" | "done"

interface Live {
  w: number
  h: number
  pct: number
  shown: number
  phase: Phase
  readyAt: number
  exitAt: number
  rot: number
  vel: number
  scratching: boolean
  lastA: number
  lastT: number
  scratch: number
  mx: number
  my: number
  sx: number
  sy: number
  wantExit: boolean
  lobbyMix: number
}

function makeShader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s)
    return null
  }
  return s
}

export default function VinylHalftonePreloader({
  children,
  loop = false,
  progress,
  durationMs = 4200,
  enter = "auto",
  preset = "rhythm",
  palette,
  title = "Kedhareswer",
  subtitle = "selected works",
  loadingWord = "Loading",
  readyWord = "Ready",
  credits = ["Design & Code", "Portfolio · Vol. 26"],
  ringText = "Side A  ·  33⅓ RPM  ·  Stereo  ·  Selected Works  ·  2019 — 2026  ·  ",
  stages = ["Mastering", "Pressing", "Spinning", "Play"],
  bpm = 120,
  hint = "",
  displayFamily = DISPLAY_STACK,
  textFamily = TEXT_STACK,
  fontHref = FONT_HREF,
  height = "100svh",
  onComplete,
  onSelectStage,
  customLogo,
  interactiveMenu = false,
  lobbyOpen = false,
  onJoinRoomCode,
  initialJoinCode = "",
  showMuteButton = true,
  className = "",
}: VinylHalftonePreloaderProps) {
  const colors = { ...(PRESETS[preset] || PRESETS.rhythm), ...(palette || {}) }
  const list = stages.length ? stages : ["Play"]
  const [run, setRun] = React.useState(0)
  const [phase, setPhase] = React.useState(interactiveMenu ? ("ready" as Phase) : ("load" as Phase))
  const [count, setCount] = React.useState(interactiveMenu ? 100 : 0)
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const [gl, setGl] = React.useState(true)
  const [reduced, setReduced] = React.useState(false)
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null)
  const [activeIdx, setActiveIdx] = React.useState<number>(0)
  const [joinCode, setJoinCode] = React.useState<string>(initialJoinCode)
  const [isMuted, setIsMuted] = React.useState<boolean>(() => {
    if (typeof (window as any).muted !== "undefined") return !!(window as any).muted
    if (typeof (window as any).Howler !== "undefined" && typeof (window as any).Howler._muted !== "undefined") {
      return !!(window as any).Howler._muted
    }
    try {
      return localStorage.getItem("famobi.muted") === "1" || localStorage.getItem("muted") === "1"
    } catch {
      return false
    }
  })

  const gateRef = React.useRef(null as HTMLDivElement | null)
  const canvasRef = React.useRef(null as HTMLCanvasElement | null)
  const ringRef = React.useRef(null as SVGGElement | null)
  const labelRef = React.useRef(null as HTMLDivElement | null)
  const spindleRef = React.useRef(null as HTMLButtonElement | null)
  const menuRef = React.useRef(null as HTMLOListElement | null)
  const playRef = React.useRef(null as HTMLButtonElement | null)
  const onCompleteRef = React.useRef(onComplete)
  onCompleteRef.current = onComplete
  const onSelectStageRef = React.useRef(onSelectStage)
  onSelectStageRef.current = onSelectStage
  const opts = React.useRef({ progress, durationMs, enter, loop, bpm, colors, n: list.length, reduced, interactiveMenu, lobbyOpen })
  opts.current = { progress, durationMs, enter, loop, bpm, colors, n: list.length, reduced, interactiveMenu, lobbyOpen }
  const live = React.useRef({} as Live)

  React.useEffect(() => {
    ;(window as any).triggerVinylMatchExit = () => {
      if (live.current) {
        live.current.wantExit = true
      }
    }
    return () => {
      if ((window as any).triggerVinylMatchExit) {
        delete (window as any).triggerVinylMatchExit
      }
    }
  }, [])

  // Fonts: one shared <link>, never duplicated, left in place for the page.
  React.useEffect(() => {
    if (!fontHref || typeof document === "undefined") return
    const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(
      (l) => (l as HTMLLinkElement).href === fontHref,
    )
    if (has) return
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = fontHref
    document.head.appendChild(link)
  }, [fontHref])

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  // Sync mute status with global audio engine & listen for 'M' key
  React.useEffect(() => {
    const syncMute = () => {
      const m = typeof (window as any).muted !== "undefined"
        ? !!(window as any).muted
        : !!((window as any).Howler?._muted)
      setIsMuted((prev) => (prev !== m ? m : prev))
    }
    const timer = setInterval(syncMute, 350)
    window.addEventListener("focus", syncMute)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", syncMute)
    }
  }, [])

  const handleToggleMute = React.useCallback(
    (e?: React.MouseEvent | KeyboardEvent) => {
      if (e && "stopPropagation" in e) {
        e.stopPropagation()
        e.preventDefault()
      }
      let nextMuted = !isMuted
      if (typeof (window as any).toggleMute === "function") {
        (window as any).toggleMute()
        if (typeof (window as any).muted !== "undefined") {
          nextMuted = !!(window as any).muted
        }
      } else if (typeof (window as any).Howler !== "undefined") {
        (window as any).Howler.mute(nextMuted)
        ;(window as any).muted = nextMuted
      }
      setIsMuted(nextMuted)

      try {
        const w = window as any
        if (w.panel && w.oImageIds) {
          if (nextMuted) {
            w.panel.switchBut(w.oImageIds.muteBut0, w.oImageIds.muteBut1)
          } else {
            w.panel.switchBut(w.oImageIds.muteBut1, w.oImageIds.muteBut0)
          }
        }
      } catch {}

      try {
        if (!nextMuted && typeof (window as any).playSound === "function") {
          (window as any).playSound("hit" + Math.floor(Math.random() * 6))
        }
      } catch {}
    },
    [isMuted]
  )

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "m" || e.key === "M") {
        handleToggleMute(e)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleToggleMute])

  // One run of the gate: GL, the clock, the count, the phases.
  React.useEffect(() => {
    if (phase === "done") return
    const gate = gateRef.current
    if (!gate) return
    const isMenu = opts.current.interactiveMenu
    const L: Live = {
      w: gate.clientWidth, h: gate.clientHeight,
      pct: isMenu ? 100 : 0, shown: isMenu ? 100 : 0,
      phase: isMenu ? "ready" : "load", readyAt: performance.now(), exitAt: 0,
      rot: 0, vel: 0, scratching: false, lastA: 0, lastT: 0, scratch: 0, mx: 0, my: 0, sx: 0, sy: 0, wantExit: false,
      lobbyMix: opts.current.lobbyOpen ? 1 : 0,
    }
    live.current = L
    setSize({ w: L.w, h: L.h })

    const canvas = canvasRef.current
    let ctx: WebGLRenderingContext | null = null
    let prog: WebGLProgram | null = null
    const U: { [k: string]: WebGLUniformLocation | null } = {}
    let soft = false
    if (canvas) {
      try {
        ctx = (canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true }) ||
          canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null
      } catch {
        ctx = null
      }
    }
    if (ctx) {
      const vs = makeShader(ctx, ctx.VERTEX_SHADER, VERT)
      const fs = makeShader(ctx, ctx.FRAGMENT_SHADER, FRAG)
      const p = vs && fs ? ctx.createProgram() : null
      if (p && vs && fs) {
        ctx.attachShader(p, vs)
        ctx.attachShader(p, fs)
        ctx.linkProgram(p)
        if (ctx.getProgramParameter(p, ctx.LINK_STATUS)) prog = p
      }
      if (prog) {
        ctx.useProgram(prog)
        const buf = ctx.createBuffer()
        ctx.bindBuffer(ctx.ARRAY_BUFFER, buf)
        ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW)
        const loc = ctx.getAttribLocation(prog, "a")
        ctx.enableVertexAttribArray(loc)
        ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0)
        for (const k of ["uRes", "uTime", "uCell", "uU", "uIntro", "uE1", "uE2", "uBeat", "uEnergy", "uNeedle",
          "uScratch", "uHole", "uPx", "uSpin", "uRec", "uBurst", "uPaper", "uInk", "uSpark"])
          U[k] = ctx.getUniformLocation(prog, k)
        const dbg = ctx.getExtension("WEBGL_debug_renderer_info")
        const name = dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ""
        soft = /swiftshader|llvmpipe|software/i.test(name)
      } else ctx = null
    }
    setGl(!!ctx)

    let scale = 1
    const resize = () => {
      L.w = Math.max(1, gate.clientWidth)
      L.h = Math.max(1, gate.clientHeight)
      setSize({ w: L.w, h: L.h })
      if (!canvas || !ctx) return
      // Pixel budget: dense screens and software GPUs drop below DPR 1 rather than stall.
      const budget = soft ? 1.1e6 : 2.4e6
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      scale = Math.min(dpr, Math.sqrt(budget / (L.w * L.h)))
      canvas.width = Math.max(1, Math.round(L.w * scale))
      canvas.height = Math.max(1, Math.round(L.h * scale))
      canvas.style.width = L.w + "px"
      canvas.style.height = L.h + "px"
      ctx.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(gate)

    const t0 = performance.now()
    let last = t0
    let loadFrom = t0 + 250
    let raf = 0
    let shownInt = -1

    const frame = (now: number) => {
      const o = opts.current
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const ms = now - t0
      const still = o.reduced

      // ---- the count ----
      if (L.phase === "load") {
        const real = o.progress
        const target =
          real === undefined
            ? vhpSimulated((now - loadFrom) / Math.max(600, o.durationMs))
            : Math.max(0, Math.min(100, Number(real) || 0))
        L.shown = still ? Math.max(L.shown, target) : Math.max(L.shown, L.shown + (target - L.shown) * Math.min(1, dt * 9))
        if (target >= 100 && L.shown > 99.5) L.shown = 100
        if (L.shown >= 100 && ms > INTRO_MS * 0.8) {
          L.phase = "ready"
          L.readyAt = now
          setPhase("ready")
        }
      }
      L.pct = L.shown
      const ci = Math.floor(L.shown)
      if (ci !== shownInt) {
        shownInt = ci
        setCount(ci)
      }
      if (L.phase === "ready" && (L.wantExit || (!o.interactiveMenu && o.enter === "auto" && now - L.readyAt > HOLD_MS))) {
        L.phase = "exit"
        L.exitAt = now
        setPhase("exit")
      }
      const exitLen = still || !ctx ? 450 : FLOOD_MS + REVEAL_MS
      if (L.phase === "exit" && now - L.exitAt > exitLen) {
        L.phase = "done"
        setPhase("done")
        return
      }

      // ---- the platter ----
      const motor = still ? 0 : vhpRpm(L.pct) * 6 * (L.phase === "exit" ? 1.6 : 1)
      if (!L.scratching) {
        L.vel += (motor - L.vel) * Math.min(1, dt * 2.2)
        L.rot += L.vel * dt
      }
      const off = L.scratching ? 1 : Math.min(1, Math.abs(L.vel - motor) / 500)
      L.scratch += (off - L.scratch) * Math.min(1, dt * 8)
      if (ringRef.current) ringRef.current.setAttribute("transform", "rotate(" + (L.rot % 360).toFixed(2) + ")")

      // ---- parallax ----
      L.sx += (L.mx - L.sx) * Math.min(1, dt * 3)
      L.sy += (L.my - L.sy) * Math.min(1, dt * 3)
      const targetLobby = o.lobbyOpen ? 1 : 0
      L.lobbyMix += (targetLobby - L.lobbyMix) * Math.min(1, dt * 7)
      const lay = vhpLayout(L.w, L.h, o.n)
      const px = still ? 0 : L.sx * lay.u * 0.012
      const py = still ? 0 : L.sy * lay.u * 0.012
      if (labelRef.current) labelRef.current.style.translate = (-px * 0.6).toFixed(1) + "px " + (-py * 0.6).toFixed(1) + "px"
      if (spindleRef.current) spindleRef.current.style.translate = (-px * 0.6).toFixed(1) + "px " + (-py * 0.6).toFixed(1) + "px"
      if (menuRef.current) menuRef.current.style.translate = (px * 1.2).toFixed(1) + "px " + (py * 1.2).toFixed(1) + "px"
      const beat = still ? 0 : vhpBeat(ms, o.bpm)
      gate.style.setProperty("--vhp-beat", beat.toFixed(3))
      if (!still) gate.style.setProperty("--vhp-slice", Math.round(((ms * 0.37) % 70) + 5) + "%")

      // ---- the plate ----
      if (ctx && prog && canvas) {
        const c = o.colors
        const s = scale
        const intro = still ? 1 : vhpClamp01(ms / INTRO_MS)
        const ie = 1 - Math.pow(1 - intro, 3)
        const et = L.phase === "exit" ? now - L.exitAt : 0
        const e1 = L.phase === "exit" && !still ? vhpClamp01(et / FLOOD_MS) : 0
        const e2 = L.phase === "exit" && !still ? vhpClamp01((et - FLOOD_MS) / REVEAL_MS) : 0
        const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
        const energy = 0.45 + 0.55 * vhpClamp01(L.pct / 100) + (L.phase === "ready" ? 0.15 : 0)
        const burstExpand = 1 + 0.45 * L.lobbyMix
        const recShrink = 1 - 0.06 * L.lobbyMix
        ctx.uniform2f(U.uRes, canvas.width, canvas.height)
        ctx.uniform1f(U.uTime, still ? 0 : ms / 1000)
        ctx.uniform1f(U.uCell, lay.cell * s)
        ctx.uniform1f(U.uU, lay.u * s)
        ctx.uniform1f(U.uPx, s)
        ctx.uniform1f(U.uIntro, ie)
        ctx.uniform1f(U.uE1, ease(e1))
        ctx.uniform1f(U.uE2, e2 > 0 ? Math.max(0.0001, ease(e2)) : 0)
        ctx.uniform1f(U.uBeat, beat)
        ctx.uniform1f(U.uEnergy, energy)
        ctx.uniform1f(U.uScratch, still ? 0 : L.scratch)
        ctx.uniform1f(U.uHole, lay.hole * s)
        ctx.uniform1f(U.uNeedle, vhpNeedle(L.pct, lay.rl * recShrink, lay.rv * recShrink) * s)
        ctx.uniform2f(U.uSpin, (lay.sx - px * 0.6) * s, (lay.sy - py * 0.6) * s)
        ctx.uniform2f(U.uRec, lay.rl * recShrink * s, lay.rv * recShrink * s)
        ctx.uniform3f(U.uBurst, (lay.bx + px) * s, (lay.by + py) * s, lay.br * burstExpand * s)
        const P = vhpRGB(c.paper, [0.95, 0.41, 0.49])
        const I = vhpRGB(c.ink, [0.11, 0.03, 0.04])
        const K = vhpRGB(c.spark, [1, 1, 1])
        ctx.uniform3f(U.uPaper, P[0], P[1], P[2])
        ctx.uniform3f(U.uInk, I[0], I[1], I[2])
        ctx.uniform3f(U.uSpark, K[0], K[1], K[2])
        ctx.clearColor(0, 0, 0, 0)
        ctx.clear(ctx.COLOR_BUFFER_BIT)
        ctx.drawArrays(ctx.TRIANGLES, 0, 3)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // ---- scratching and parallax ----
    const local = (e: PointerEvent) => {
      const r = gate.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest("button, input, form")) return
      const p = local(e)
      const lay = vhpLayout(L.w, L.h, opts.current.n)
      const d = Math.hypot(p.x - lay.sx, p.y - lay.sy)
      if (d > lay.rv || d < lay.hole) return
      L.scratching = true
      L.lastA = Math.atan2(p.y - lay.sy, p.x - lay.sx)
      L.lastT = performance.now()
      gate.dataset.scratch = "true"
      try {
        gate.setPointerCapture(e.pointerId)
      } catch {}
    }
    const onMove = (e: PointerEvent) => {
      const p = local(e)
      L.mx = (p.x / L.w) * 2 - 1
      L.my = (p.y / L.h) * 2 - 1
      if (!L.scratching) return
      const lay = vhpLayout(L.w, L.h, opts.current.n)
      const a = Math.atan2(p.y - lay.sy, p.x - lay.sx)
      const now = performance.now()
      const da = (vhpAngleDelta(a, L.lastA) * 180) / Math.PI
      const dts = Math.max(0.008, (now - L.lastT) / 1000)
      L.rot += da
      L.vel = L.vel * 0.5 + (da / dts) * 0.5
      L.lastA = a
      L.lastT = now
    }
    const onUp = () => {
      L.scratching = false
      delete gate.dataset.scratch
    }
    const onLeave = () => {
      L.mx = 0
      L.my = 0
    }
    gate.addEventListener("pointerdown", onDown)
    gate.addEventListener("pointermove", onMove)
    gate.addEventListener("pointerup", onUp)
    gate.addEventListener("pointercancel", onUp)
    gate.addEventListener("pointerleave", onLeave)
    const onLost = (e: Event) => {
      e.preventDefault()
      setGl(false)
    }
    canvas?.addEventListener("webglcontextlost", onLost)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      gate.removeEventListener("pointerdown", onDown)
      gate.removeEventListener("pointermove", onMove)
      gate.removeEventListener("pointerup", onUp)
      gate.removeEventListener("pointercancel", onUp)
      gate.removeEventListener("pointerleave", onLeave)
      canvas?.removeEventListener("webglcontextlost", onLost)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, phase === "done"])

  // After the lift: report, or rest a moment and run the showcase again.
  React.useEffect(() => {
    if (phase !== "done") return
    if (!loop) {
      onCompleteRef.current?.()
      return
    }
    const t = setTimeout(() => {
      setCount(0)
      setPhase("load")
      setRun((r) => r + 1)
    }, LOOP_REST_MS)
    return () => clearTimeout(t)
  }, [phase, loop])

  // "click" mode: hand focus to the way in as soon as it opens.
  React.useEffect(() => {
    if (phase === "ready" && enter === "click") playRef.current?.focus({ preventScroll: true })
  }, [phase, enter])

  const handleClickStage = (index: number, label: string) => {
    setActiveIdx(index)
    if (onSelectStageRef.current) {
      onSelectStageRef.current(index, label)
    }
    // In interactiveMenu mode, clicking stages opens the Pre-Game Lobby or Profile Modal
    // over the expanded black halftone starburst; the ink-flood exit only triggers when
    // the player clicks "START MATCH" in the lobby (via window.triggerVinylMatchExit).
    if (!interactiveMenu) {
      if (live.current) live.current.wantExit = true
    }
  }

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const clean = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    if (clean && onJoinRoomCode) {
      onJoinRoomCode(clean)
    }
  }

  const goIn = () => {
    if (live.current.phase === "ready") live.current.wantExit = true
  }

  const lay = vhpLayout(size.w || 1280, size.h || 720, list.length)
  const ready = phase === "ready" || phase === "exit"
  const lit = interactiveMenu
    ? (hoveredIdx !== null ? hoveredIdx : activeIdx)
    : (ready ? list.length - 1 : vhpStage(count, list.length))
  const ringR = lay.rl * 0.925
  const ringFont = Math.max(9, lay.u * 0.022)
  const ringId = "vhp-ring-" + run
  const fade = phase === "exit" && (reduced || !gl)

  return (
    <div
      className={"vhp-root " + className}
      style={
        {
          height,
          background: loop && !children ? colors.ink : undefined,
          "--vhp-paper": colors.paper,
          "--vhp-ink": colors.ink,
          "--vhp-glow": colors.glow,
          "--vhp-edge": colors.edge,
          "--vhp-halo": "color-mix(in srgb, " + colors.glow + " 55%, transparent)",
          "--vhp-shade": "color-mix(in srgb, " + colors.ink + " 22%, transparent)",
          "--vhp-display": displayFamily,
          "--vhp-text": textFamily,
          "--vhp-cell": lay.cell * 1.15 + "px",
        } as React.CSSProperties
      }
    >
      <style>{VHP_CSS}</style>
      {children}
      {phase === "done" ? null : (
        <div
          key={run}
          ref={gateRef}
          className="vhp-gate"
          data-phase={phase}
          data-lobby={lobbyOpen ? "true" : "false"}
          data-gl={gl}
          data-fade={fade}
          role="progressbar"
          aria-label={title + ": " + loadingWord}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={count}
        >
          {gl ? (
            <canvas ref={canvasRef} className="vhp-canvas" aria-hidden="true" />
          ) : (
            <div
              className="vhp-dots"
              aria-hidden="true"
              style={{
                WebkitMaskImage:
                  "radial-gradient(circle at " + lay.sx + "px " + lay.sy + "px, transparent " + lay.hole + "px, #000 " +
                  (lay.hole + 1) + "px, #000 " + lay.hole * 1.6 + "px, transparent " + lay.hole * 1.7 + "px, transparent " +
                  lay.rl + "px, #000 " + (lay.rl + lay.u * 0.03) + "px, #000 " + lay.rv + "px, transparent " +
                  (lay.rv + lay.u * 0.03) + "px), radial-gradient(circle at " + lay.bx + "px " + lay.by + "px, #000 " +
                  lay.br * 0.9 + "px, transparent " + lay.br * 1.5 + "px)",
                maskImage:
                  "radial-gradient(circle at " + lay.sx + "px " + lay.sy + "px, transparent " + lay.rl + "px, #000 " +
                  (lay.rl + lay.u * 0.03) + "px, #000 " + lay.rv + "px, transparent " + (lay.rv + lay.u * 0.03) +
                  "px), radial-gradient(circle at " + lay.bx + "px " + lay.by + "px, #000 " + lay.br * 0.9 +
                  "px, transparent " + lay.br * 1.5 + "px), radial-gradient(circle at " + lay.sx + "px " + lay.sy +
                  "px, #000 " + lay.hole + "px, transparent " + (lay.hole + 1) + "px)",
              }}
            />
          )}

          <svg
            className="vhp-ring"
            aria-hidden="true"
            width={ringR * 2 + 40}
            height={ringR * 2 + 40}
            viewBox={-ringR - 20 + " " + (-ringR - 20) + " " + (ringR * 2 + 40) + " " + (ringR * 2 + 40)}
            style={{ left: lay.sx - ringR - 20, top: lay.sy - ringR - 20 }}
          >
            <g ref={ringRef}>
              <defs>
                <path id={ringId} d={"M " + -ringR + " 0 A " + ringR + " " + ringR + " 0 1 1 " + ringR + " 0 A " + ringR + " " + ringR + " 0 1 1 " + -ringR + " 0"} />
              </defs>
              <circle r={lay.rl * 0.985} fill="none" stroke={colors.ink} strokeWidth={lay.u * 0.012} strokeDasharray={lay.u * 0.006 + " " + lay.u * 0.0135} opacity={0.55} />
              <circle r={ringR - ringFont * 0.95} fill="none" stroke={colors.ink} strokeWidth={0.75} opacity={0.35} />
              <text fontSize={ringFont} opacity={0.62}>
                <textPath href={"#" + ringId}>{ringText + ringText + ringText}</textPath>
              </text>
            </g>
          </svg>

          {/* 🎛️ Interactive Turntable Spindle Center Mute/Unmute Button */}
          {showMuteButton && (
            <button
              ref={spindleRef}
              type="button"
              className="vhp-spindle-mute"
              data-muted={isMuted}
              style={{
                left: lay.sx,
                top: lay.sy,
                width: Math.max(38, Math.round(lay.hole * 2.05)),
                height: Math.max(38, Math.round(lay.hole * 2.05)),
              }}
              onClick={handleToggleMute}
              aria-label={isMuted ? "Unmute Music and SFX (M)" : "Mute Music and SFX (M)"}
              title={isMuted ? "Unmute Audio (M)" : "Mute Audio (M)"}
            >
              {isMuted ? (
                <svg className="vhp-spindle-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#ff4d6d" opacity="0.65" />
                  <line x1="22" y1="2" x2="2" y2="22" stroke="#ff0055" strokeWidth="2.8" strokeLinecap="round" />
                  <line x1="22" y1="2" x2="2" y2="22" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
                </svg>
              ) : (
                <svg className="vhp-spindle-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#00f0ff" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="#00f0ff" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="#00f0ff" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
                </svg>
              )}
              <span className="vhp-spindle-tooltip" aria-hidden="true">
                {isMuted ? "UNMUTE [M]" : "MUTE [M]"}
              </span>
            </button>
          )}

          <div
            ref={labelRef}
            className="vhp-label"
            data-align={lay.portrait ? "center" : "start"}
            style={{ left: lay.tx, top: lay.ty, fontSize: lay.ts, maxWidth: lay.tw }}
            aria-hidden="true"
          >
            {customLogo ? (
              customLogo
            ) : (
              <>
                <span className="vhp-title">{title}</span>
                <span className="vhp-sub">{subtitle}</span>
                <span className="vhp-big">
                  <b key={ready ? "r" : "l"} data-ready={ready}>
                    {ready ? readyWord : loadingWord}
                  </b>
                  <span className="vhp-count">{vhpPad(count)}</span>
                </span>
                <span className="vhp-cred">
                  {credits.map((c, i) => (
                    <React.Fragment key={i}>
                      {i ? <br /> : null}
                      {c}
                    </React.Fragment>
                  ))}
                </span>
              </>
            )}
          </div>

          <ol ref={menuRef} className="vhp-menu" style={{ fontSize: lay.fs }}>
            {list.map((s, i) => {
              const isHovered = hoveredIdx === i
              const isCurrent = hoveredIdx === null && i === activeIdx
              const isLit = interactiveMenu ? (isHovered || isCurrent) : (i === lit)
              const state = isLit ? "on" : "done"
              return (
                <li
                  key={i}
                  className="vhp-stage"
                  style={{ left: lay.mx + i * lay.dx, top: lay.my + i * lay.dy, ["--i" as string]: i } as React.CSSProperties}
                >
                  <button
                    ref={i === list.length - 1 ? playRef : undefined}
                    type="button"
                    className="vhp-item"
                    data-state={state}
                    data-text={s}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onClick={() => handleClickStage(i, s)}
                  >
                    {s}
                    <span className="vhp-play" aria-hidden="true">{i === 3 ? "★" : "▶"}</span>
                  </button>
                </li>
              )
            })}
          </ol>

          {interactiveMenu && onJoinRoomCode && (
            <form
              className="vhp-join-bar"
              style={{
                left: lay.mx + list.length * lay.dx,
                top: lay.my + list.length * lay.dy + lay.fs * 0.12,
              }}
              onSubmit={handleJoinSubmit}
            >
              <span className="vhp-join-tag">ROOM CODE</span>
              <input
                type="text"
                className="vhp-join-input"
                maxLength={6}
                placeholder="ABCDEF"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                aria-label="Enter 6-character room code"
              />
              <button type="submit" className="vhp-join-btn">
                JOIN ▶
              </button>
            </form>
          )}

          {hint ? (
            <p className="vhp-hint" aria-hidden="true">
              <i />
              {ready && enter === "click" ? "Press " + list[list.length - 1] : hint}
            </p>
          ) : null}
          <span className="vhp-sr" aria-live="polite">
            {ready ? readyWord : ""}
          </span>
        </div>
      )}
    </div>
  )
}

// Declared after the JSX: the 21st CLI tokenizer hangs on mapped types before it.
type VinylPresetMap = { [K in VinylPreset]: VinylPalette }
