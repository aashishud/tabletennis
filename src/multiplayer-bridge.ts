import { BOT_PROFILE, type DiscordAuthManager, type PlayerIdentity } from './auth';
import type {
  BallHitPacket,
  BallMissPacket,
  GameMode,
  GamePacket,
  GuestSide,
  PointResultPacket,
  WebRTCRoomManager,
} from './network';

declare global {
  interface Window {
    TTWTMultiplayer: MultiplayerBridge;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    userBat: any;
    enemyBat: any;
    ball: any;
    tableTop: any;
    panel: any;
    oGameData: any;
    gameState: string;
    firstRun: boolean;
    rallyHits: number;
    initGame: (restart?: boolean) => void;
    _initGame: () => void;
    initStartScreen?: () => void;
    updateScore: (winner: 'user' | 'enemy') => void;
    initGameComplete: () => void;
    playSound: (id: string) => void;
  }
}

export type ControlMode = 'BOT_MODE' | 'NETWORK_MODE';

export interface ArenaMapConfig {
  id: string;
  name: string;
  subtitle: string;
  wallId: number;
  tableId: number;
  previewTableHex: string;
  previewWallHex: string;
  atmosphereTint: string;
  accentHex: string;
}

export const ARENA_MAPS: ArenaMapConfig[] = [
  {
    id: 'classic',
    name: 'CLASSIC GYM',
    subtitle: 'BLUE COURT • WOOD HALL',
    wallId: 0,
    tableId: 0,
    previewTableHex: '#0284c7',
    previewWallHex: '#b47b44',
    atmosphereTint: 'rgba(0, 140, 255, 0.04)',
    accentHex: '#00f0ff',
  },
  {
    id: 'cyber',
    name: 'NEON CYBER',
    subtitle: 'SYNTHWAVE • VIOLET GRID',
    wallId: 1,
    tableId: 1,
    previewTableHex: '#7e22ce',
    previewWallHex: '#1e1b4b',
    atmosphereTint: 'rgba(168, 85, 247, 0.14)',
    accentHex: '#ff007f',
  },
  {
    id: 'emerald',
    name: 'EMERALD CLUB',
    subtitle: 'GREEN TURF • BRICK HALL',
    wallId: 2,
    tableId: 2,
    previewTableHex: '#059669',
    previewWallHex: '#7c2d12',
    atmosphereTint: 'rgba(16, 185, 129, 0.08)',
    accentHex: '#00ff66',
  },
  {
    id: 'sunset',
    name: 'SUNSET DOJO',
    subtitle: 'GOLD COURT • WARM GLOW',
    wallId: 3,
    tableId: 3,
    previewTableHex: '#d97706',
    previewWallHex: '#78350f',
    atmosphereTint: 'rgba(255, 120, 0, 0.10)',
    accentHex: '#ffe600',
  },
  {
    id: 'midnight',
    name: 'TOKYO NIGHT',
    subtitle: 'CRIMSON COURT • DARK SKY',
    wallId: 4,
    tableId: 1,
    previewTableHex: '#be185d',
    previewWallHex: '#0f172a',
    atmosphereTint: 'rgba(255, 0, 127, 0.14)',
    accentHex: '#00f0ff',
  },
];

export interface PaddleColorOption {
  id: string;
  name: string;
  hex: string;
}

export const PADDLE_COLORS: PaddleColorOption[] = [
  { id: 'red', name: 'ARCADE RED', hex: '#ef4444' },
  { id: 'cyan', name: 'NEON CYAN', hex: '#00f0ff' },
  { id: 'pink', name: 'HOT PINK', hex: '#ff007f' },
  { id: 'yellow', name: 'ELECTRIC GOLD', hex: '#ffe600' },
  { id: 'green', name: 'TOXIC GREEN', hex: '#00ff66' },
  { id: 'purple', name: 'ROYAL PURPLE', hex: '#a855f7' },
  { id: 'orange', name: 'BLAZE ORANGE', hex: '#ff6b00' },
  { id: 'white', name: 'FROST WHITE', hex: '#f8fafc' },
];

export interface ExtraPaddle {
  index: number;
  side: 'user' | 'enemy';
  isNetworkTeammate: boolean;
  label: string;
  colorHex: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  laneOffsetX: number;
}

export class MultiplayerBridge {
  public mode: ControlMode = 'BOT_MODE';
  public gameMode: GameMode = '1v1';
  public guestSide: GuestSide = 'opposite';
  public peerPaused = false;
  public selectedMapId: string = 'classic';
  public localPaddleColor: string = '#ef4444';
  public remotePaddleColor: string = '#00f0ff';

  private auth: DiscordAuthManager;
  private net: WebRTCRoomManager;
  private seq = 0;
  private lastPointProcessedAt = 0;
  private lastSentNormX = Number.NaN;
  private lastSentNormY = Number.NaN;
  private lastSentPaddleAt = 0;
  private tintedPaddleCache = new Map<string, HTMLCanvasElement>();
  private mapSnapshotCache = new Map<string, string>();
  private lobbyListeners: Array<() => void> = [];
  private extraUserPaddles: ExtraPaddle[] = [];
  private extraEnemyPaddles: ExtraPaddle[] = [];
  private coopPartnerTargX = 110;
  private coopPartnerTargY = 0;
  private lastExtraBotHitAt = 0;

  constructor(auth: DiscordAuthManager, net: WebRTCRoomManager) {
    this.auth = auth;
    this.net = net;

    try {
      const savedColor = localStorage.getItem('pongpong_paddle_color');
      if (savedColor && PADDLE_COLORS.some((c) => c.hex === savedColor)) {
        this.localPaddleColor = savedColor;
      }
    } catch {}

    this.auth.preloadAvatar(BOT_PROFILE.avatarUrl);

    this.auth.onChange((user) => {
      this.auth.preloadAvatar(user.avatarUrl);
      this.net.setLocalPlayer(user);
    });

    this.net.onRemotePlayerChange((remote) => {
      if (remote?.avatarUrl) {
        this.auth.preloadAvatar(remote.avatarUrl);
      }
      if (remote) {
        this.broadcastLobbyState();
      }
      this.notifyLobbyListeners();
    });

    this.net.onPacket((packet) => this.handlePacket(packet));
    this.net.onStatusChange((status) => {
      if (status === 'connected') {
        this.setMode(this.isCoOpSameSide() ? 'BOT_MODE' : 'NETWORK_MODE');
        this.broadcastLobbyState();
      } else if (status === 'disconnected' || status === 'error') {
        this.setMode('BOT_MODE');
        this.peerPaused = false;
      }
      this.notifyLobbyListeners();
    });

    // Notify peer when this browser tab loses focus / minimizes so matches aren't ghosted
    document.addEventListener('visibilitychange', () => {
      const isHidden = document.hidden;
      if (this.net.status === 'connected') {
        this.net.sendReliable({
          type: 'PEER_PAUSED',
          paused: isHidden,
          username: this.auth.getUser()?.displayName || this.auth.getUser()?.username,
        });
      }
    });
  }

  public onLobbyStateChange(cb: () => void) {
    this.lobbyListeners.push(cb);
  }

  private notifyLobbyListeners() {
    for (const cb of this.lobbyListeners) {
      cb();
    }
  }

  public getSelectedMap(): ArenaMapConfig {
    return ARENA_MAPS.find((m) => m.id === this.selectedMapId) || ARENA_MAPS[0];
  }

  public getSelectedWallId(): number {
    return this.getSelectedMap().wallId;
  }

  public getSelectedTableId(): number {
    return this.getSelectedMap().tableId;
  }

  public canLocalSelectMap(): boolean {
    // Host (or solo player not connected as guest) can change the map
    return this.net.role !== 'guest';
  }

  public getTeamSize(): number {
    if (this.gameMode === '2v2') return 2;
    if (this.gameMode === '4v4') return 4;
    return 1;
  }

  public isCoOpSameSide(): boolean {
    return (
      this.gameMode !== '1v1' &&
      this.guestSide === 'same' &&
      this.net.status === 'connected'
    );
  }

  public setGameMode(mode: GameMode) {
    if (!this.canLocalSelectMap()) return;
    this.gameMode = mode;
    if (mode === '1v1') {
      this.guestSide = 'opposite';
    }
    this.broadcastLobbyState();
    this.notifyLobbyListeners();
  }

  public setGuestSide(side: GuestSide) {
    if (this.gameMode === '1v1') return;
    this.guestSide = side;
    this.broadcastLobbyState();
    this.notifyLobbyListeners();
  }

  public setSelectedMap(mapId: string) {
    if (!this.canLocalSelectMap()) return;
    if (!ARENA_MAPS.some((m) => m.id === mapId)) return;
    this.selectedMapId = mapId;
    this.applyMapToActiveGame();
    this.broadcastLobbyState();
    this.notifyLobbyListeners();
  }

  public setLocalPaddleColor(hex: string) {
    if (!PADDLE_COLORS.some((c) => c.hex === hex)) return;
    this.localPaddleColor = hex;
    try {
      localStorage.setItem('pongpong_paddle_color', hex);
    } catch {}
    this.broadcastLobbyState();
    this.notifyLobbyListeners();
  }

  public broadcastLobbyState() {
    if (!this.net.roomCode) return;
    this.net.sendReliable({
      type: 'LOBBY_UPDATE',
      gameMode: this.canLocalSelectMap() ? this.gameMode : undefined,
      guestSide: this.guestSide,
      mapId: this.canLocalSelectMap() ? this.selectedMapId : undefined,
      paddleColor: this.localPaddleColor,
      senderRole: this.net.role,
    });
  }

  private applyMapToActiveGame() {
    const mapCfg = this.getSelectedMap();
    if (window.oGameData) {
      window.oGameData.cupId = mapCfg.wallId;
      window.oGameData.gameId = mapCfg.tableId;
    }
    if (window.tableTop) {
      window.tableTop.id = mapCfg.tableId;
    }
    if ((window as any).background) {
      (window as any).background.wallId = mapCfg.wallId;
    }
  }

  public renderMapAtmosphere(ctx: CanvasRenderingContext2D) {
    const canvas = window.canvas;
    if (!canvas) return;
    const mapCfg = this.getSelectedMap();
    if (mapCfg.atmosphereTint) {
      ctx.save();
      ctx.fillStyle = mapCfg.atmosphereTint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  /**
   * Renders an authentic HD in-game snapshot of the given Arena Map directly from
   * the loaded game sprite sheets (gym walls, parquet floor, 3D table, net, and atmospheric lighting).
   */
  public getMapSnapshotDataUrl(mapId: string): string {
    const cached = this.mapSnapshotCache.get(mapId);
    if (cached) return cached;

    const mapCfg = ARENA_MAPS.find((m) => m.id === mapId) || ARENA_MAPS[0];
    const assetLib = (window as any).assetLib;
    const oImageIds = (window as any).oImageIds;

    if (assetLib && oImageIds && typeof assetLib.getData === 'function') {
      try {
        const gameElements = assetLib.getData('gameElements');
        const shadowData = assetLib.getData('shadow');
        const img: HTMLImageElement | undefined = gameElements?.img;
        const atlas = gameElements?.oData?.oAtlasData;

        if (img && img.complete && img.naturalWidth > 0 && atlas) {
          const w = 700;
          const h = 420;
          const baseY = 115; // Camera horizon matching in-game perspective
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cCtx = c.getContext('2d');

          if (cCtx) {
            cCtx.fillStyle = '#080512';
            cCtx.fillRect(0, 0, w, h);

            // 1. Hardwood Parquet Floor (tableBgBottom)
            const floorRect = atlas[oImageIds.tableBgBottom];
            if (floorRect) {
              const tempTop = baseY - 220 + 193;
              cCtx.drawImage(
                img,
                floorRect.x,
                floorRect.y,
                floorRect.width,
                floorRect.height,
                0,
                tempTop,
                w,
                (h - tempTop) * 1.18
              );
            }

            // 2. Arena Stadium Wall (tableBg0..4)
            const wallRect = atlas[oImageIds[`tableBg${mapCfg.wallId}`]];
            if (wallRect) {
              cCtx.drawImage(
                img,
                wallRect.x,
                wallRect.y,
                wallRect.width,
                wallRect.height,
                0,
                baseY - 205,
                w,
                wallRect.height
              );
            }

            const table0Rect = atlas[oImageIds.table0];
            const tableH = table0Rect ? table0Rect.height : 220;

            // 3. 3D Floor Drop Shadow
            if (shadowData?.img?.complete && shadowData.img.naturalWidth > 0) {
              const sImg = shadowData.img;
              cCtx.drawImage(
                sImg,
                0,
                0,
                sImg.width,
                sImg.height,
                w / 2 - sImg.width / 2,
                baseY + tableH - 80,
                sImg.width,
                sImg.height
              );
            }

            // 4. Table Legs
            const legsRect = atlas[oImageIds.tableLegs];
            if (legsRect) {
              cCtx.drawImage(
                img,
                legsRect.x,
                legsRect.y,
                legsRect.width,
                legsRect.height,
                w / 2 - legsRect.width / 2,
                baseY + tableH + 25,
                legsRect.width,
                legsRect.height
              );
            }

            // 5. 3D Regulation Table Surface (table0..3)
            const tblRect = atlas[oImageIds[`table${mapCfg.tableId}`]] || table0Rect;
            if (tblRect) {
              cCtx.drawImage(
                img,
                tblRect.x,
                tblRect.y,
                tblRect.width,
                tblRect.height,
                w / 2 - tblRect.width / 2,
                baseY,
                tblRect.width,
                tblRect.height
              );
            }

            // 6. Table Front Apron Edge
            const edgeRect = atlas[oImageIds.tableEdge];
            if (edgeRect) {
              cCtx.drawImage(
                img,
                edgeRect.x,
                edgeRect.y,
                edgeRect.width,
                edgeRect.height,
                w / 2 - edgeRect.width / 2,
                baseY + tableH,
                edgeRect.width,
                edgeRect.height
              );
            }

            // 7. Net Brackets & Mesh Net
            const netRect = atlas[oImageIds.net];
            const clipRect = atlas[oImageIds.tableClip];
            if (netRect) {
              const netY = baseY - netRect.height + tableH * 0.282;
              if (clipRect) {
                cCtx.drawImage(
                  img,
                  clipRect.x,
                  clipRect.y,
                  clipRect.width,
                  clipRect.height,
                  w / 2 - clipRect.width / 2,
                  netY + netRect.height - 3,
                  clipRect.width,
                  clipRect.height
                );
              }
              cCtx.drawImage(
                img,
                netRect.x,
                netRect.y,
                netRect.width,
                netRect.height,
                w / 2 - netRect.width / 2,
                netY,
                netRect.width,
                netRect.height
              );
            }

            // 8. Map Atmospheric Tint & Brawler Arena Vignette
            if (mapCfg.atmosphereTint) {
              cCtx.fillStyle = mapCfg.atmosphereTint;
              cCtx.fillRect(0, 0, w, h);
            }

            const vig = cCtx.createRadialGradient(w / 2, h * 0.5, h * 0.2, w / 2, h * 0.5, w * 0.65);
            vig.addColorStop(0, 'rgba(0,0,0,0)');
            vig.addColorStop(1, 'rgba(6, 4, 16, 0.55)');
            cCtx.fillStyle = vig;
            cCtx.fillRect(0, 0, w, h);

            const dataUrl = c.toDataURL('image/jpeg', 0.9);
            this.mapSnapshotCache.set(mapId, dataUrl);
            return dataUrl;
          }
        }
      } catch {
        // Fallback below if canvas isn't ready yet
      }
    }

    // Fallback SVG data URL while assets are still loading in the first second
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
      <rect width="400" height="240" fill="${mapCfg.previewWallHex}"/>
      <polygon points="90,95 310,95 355,195 45,195" fill="${mapCfg.previewTableHex}" stroke="#ffffff" stroke-width="4"/>
      <line x1="200" y1="95" x2="200" y2="195" stroke="#ffffff" stroke-width="3"/>
      <line x1="65" y1="140" x2="335" y2="140" stroke="rgba(255,255,255,0.85)" stroke-width="5"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  private hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    if (Number.isNaN(num)) return [239, 68, 68];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  /**
   * Renders a custom-tinted rubber surface on either userBat or enemyBat while keeping
   * the 3D dimple texture, edge shading, and wooden handle intact.
   */
  public drawTintedPaddleRubber(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    bX: number,
    bY: number,
    bWidth: number,
    bHeight: number,
    destX: number,
    destY: number,
    who: 'user' | 'enemy',
    customHexOverride?: string
  ) {
    const targetHex =
      customHexOverride || (who === 'user' ? this.localPaddleColor : this.remotePaddleColor);
    const cacheKey = `${targetHex}:${bX}:${bY}:${bWidth}:${bHeight}`;
    let offCanvas = this.tintedPaddleCache.get(cacheKey);

    if (!offCanvas && img && img.complete && bWidth > 0 && bHeight > 0) {
      try {
        const c = document.createElement('canvas');
        c.width = bWidth;
        c.height = bHeight;
        const cCtx = c.getContext('2d');
        if (cCtx) {
          cCtx.drawImage(img, bX, bY, bWidth, bHeight, 0, 0, bWidth, bHeight);
          const imgData = cCtx.getImageData(0, 0, bWidth, bHeight);
          const data = imgData.data;
          const [tr, tg, tb] = this.hexToRgb(targetHex);

          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a > 0) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              // Extract luminance from original red rubber sprite (~0.38 average)
              const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              const shade = Math.min(1.32, lum / 0.40);
              const spec = Math.max(0, (lum - 0.52) * 110);
              data[i] = Math.min(255, Math.round(tr * shade + spec));
              data[i + 1] = Math.min(255, Math.round(tg * shade + spec));
              data[i + 2] = Math.min(255, Math.round(tb * shade + spec));
            }
          }
          cCtx.putImageData(imgData, 0, 0);
          offCanvas = c;
          this.tintedPaddleCache.set(cacheKey, c);
        }
      } catch {
        // Fallback to raw sprite if canvas is tainted
      }
    }

    if (offCanvas) {
      ctx.drawImage(offCanvas, 0, 0, bWidth, bHeight, destX, destY, bWidth, bHeight);
    } else {
      ctx.drawImage(img, bX, bY, bWidth, bHeight, destX, destY, bWidth, bHeight);
    }
  }

  public isPeerConnected(): boolean {
    return this.net.status === 'connected';
  }

  public setMode(mode: ControlMode) {
    this.mode = mode;
    if (window.enemyBat) {
      window.enemyBat.controlMode = mode;
      if (mode === 'NETWORK_MODE') {
        if (window.enemyBat.moveTween) {
          window.enemyBat.moveTween.kill();
          window.enemyBat.moveTween = null;
        }
        window.enemyBat.trackBall = false;
        window.enemyBat.flailInc = 0;
        window.enemyBat.slideInc = 0;
      }
    }
  }

  private gameStateListeners: Array<(state: string) => void> = [];

  public onGameStateChange(state: string) {
    for (const cb of this.gameStateListeners) {
      cb(state);
    }
    if (state === 'start') {
      const vhpRoot = document.getElementById('vhp-mount-root');
      if (!vhpRoot && typeof (window as any).replayVinylPreloader === 'function') {
        (window as any).replayVinylPreloader();
      }
    }
  }

  public registerGameStateListener(cb: (state: string) => void) {
    this.gameStateListeners.push(cb);
  }

  /**
   * Initializes extra teammate and opponent paddles for 2v2 (1 extra per side)
   * and 4v4 (3 extra per side).
   */
  private initExtraPaddles() {
    const canvas = window.canvas;
    const cx = canvas ? canvas.width / 2 : 350;
    const cyBottom = canvas ? canvas.height - 150 : 450;
    const cyTop = canvas ? canvas.height / 4 - 35 : 130;

    const extraCount = this.getTeamSize() - 1;
    this.extraUserPaddles = [];
    this.extraEnemyPaddles = [];
    if (extraCount <= 0) return;

    const laneOffsets = extraCount === 1 ? [125] : [-165, -60, 165];
    const teamColors = ['#00ff66', '#ffe600', '#a855f7'];
    const enemyColors = ['#ff6b00', '#ff007f', '#00f0ff'];

    for (let i = 0; i < extraCount; i++) {
      const isNetworkPartner = i === 0 && this.isCoOpSameSide();
      const partnerName =
        this.net.remotePlayer?.displayName?.slice(0, 7).toUpperCase() || '2P';
      this.extraUserPaddles.push({
        index: i,
        side: 'user',
        isNetworkTeammate: isNetworkPartner,
        label: isNetworkPartner ? partnerName : `BOT ${i + 1}`,
        colorHex: isNetworkPartner
          ? this.remotePaddleColor
          : teamColors[i % teamColors.length],
        x: cx + laneOffsets[i],
        y: cyBottom,
        rotation: laneOffsets[i] / 220,
        scale: 0.72,
        laneOffsetX: laneOffsets[i],
      });

      this.extraEnemyPaddles.push({
        index: i,
        side: 'enemy',
        isNetworkTeammate: false,
        label: `BOT ${i + 2}`,
        colorHex: enemyColors[i % enemyColors.length],
        x: cx - laneOffsets[i],
        y: cyTop,
        rotation: -laneOffsets[i] / 220,
        scale: 0.42,
        laneOffsetX: -laneOffsets[i],
      });
    }
  }

  /**
   * Starts a match (1v1, 2v2, or 4v4). If Player 2 is connected, starts synchronized match.
   * If alone, starts with AI Bots filling all remaining slots on both sides!
   */
  public start1v1Match() {
    window.firstRun = false;
    this.applyMapToActiveGame();
    if (this.net.status === 'connected') {
      this.startMultiplayerMatch(true);
    } else {
      this.setMode('BOT_MODE');
      // Give AI Bot a contrasting paddle color in solo mode
      this.remotePaddleColor = this.localPaddleColor === '#00f0ff' ? '#ff007f' : '#00f0ff';
      if (typeof window._initGame === 'function') {
        window._initGame();
      } else if (typeof window.initGame === 'function') {
        window.initGame(true);
      }
      this.initExtraPaddles();
    }
  }

  /**
   * Forfeits the current match and opens the Match Results (`gameComplete`) screen.
   * In multiplayer VS mode, sends a MATCH_FORFEIT packet so the opponent is awarded the win.
   */
  public forfeitOrExitMatch() {
    if (this.net.status === 'connected' && !this.isCoOpSameSide()) {
      this.net.sendReliable({
        type: 'MATCH_FORFEIT',
        by: this.net.role,
      });
    } else {
      this.setMode('BOT_MODE');
    }

    if (window.oGameData) {
      window.oGameData.userScore = Math.min(window.oGameData.userScore || 0, 10);
      window.oGameData.enemyScore = 11;
    }

    if (typeof (window as any)._initGameComplete === 'function') {
      (window as any)._initGameComplete();
    } else if (typeof window.initGameComplete === 'function') {
      window.initGameComplete();
    } else if (typeof window.initStartScreen === 'function') {
      window.initStartScreen();
    }
  }

  /**
   * Starts a synchronized Multiplayer Match (1v1, 2v2, or 4v4) on both Host and Guest canvases.
   */
  public startMultiplayerMatch(asInitiator = true) {
    const coOp = this.isCoOpSameSide();
    // In Co-Op Same-Side mode, top side is controlled by AI Bots (`BOT_MODE`)!
    this.setMode(coOp ? 'BOT_MODE' : 'NETWORK_MODE');
    this.applyMapToActiveGame();

    // Ensure tutorial overlay is skipped for multiplayer matches
    window.firstRun = false;
    if (window.oGameData) {
      if (window.oGameData.userId === null || window.oGameData.userId === 1234) {
        window.oGameData.userId = 0;
      }
      if (window.oGameData.enemyId === null) {
        window.oGameData.enemyId = 1;
      }
    }

    if (asInitiator && this.net.status === 'connected') {
      this.net.sendReliable({
        type: 'MATCH_START',
        gameMode: this.gameMode,
        guestSide: this.guestSide,
        mapId: this.selectedMapId,
        hostPaddleColor: this.net.role === 'host' ? this.localPaddleColor : this.remotePaddleColor,
        guestPaddleColor: this.net.role === 'guest' ? this.localPaddleColor : this.remotePaddleColor,
        cupId: window.oGameData?.cupId || 0,
        gameId: window.oGameData?.gameId || 0,
      });
    }

    if (typeof window._initGame === 'function') {
      window._initGame();
    } else if (typeof window.initGame === 'function') {
      window.initGame(true);
    }

    this.initExtraPaddles();

    // Configure initial serve: Host serves first ('user' on Host, 'enemy' on Guest unless Co-Op same side)
    setTimeout(() => {
      if (window.enemyBat) {
        window.enemyBat.controlMode = coOp ? 'BOT_MODE' : 'NETWORK_MODE';
        window.enemyBat.networkTargX = 0;
        window.enemyBat.networkTargY = 0;
      }
      if (window.ball) {
        const initialServer = !coOp && this.net.role === 'guest' ? 'enemy' : 'user';
        window.ball.serveFlip = coOp ? true : this.net.role !== 'guest';
        window.ball.resetServe(initialServer);
      }
    }, 30);
  }

  /**
   * Called every animation frame from `updateGameEvent()` in `js/app.js`.
   * Updates extra 2v2 / 4v4 paddles and streams local paddle coordinates over WebRTC.
   */
  public onFrameTick() {
    this.updateExtraPaddles();

    const coOp = this.isCoOpSameSide();
    if (this.net.status === 'connected') {
      const desiredMode: ControlMode = coOp ? 'BOT_MODE' : 'NETWORK_MODE';
      if (this.mode !== desiredMode) {
        this.setMode(desiredMode);
      }
    }
    if (this.net.status !== 'connected') return;

    const canvas = window.canvas;
    const userBat = window.userBat;
    if (!canvas || !userBat) return;

    const normX = Math.max(-1.2, Math.min(1.2, (userBat.x - canvas.width / 2) / 250));
    const maxY = userBat.maxY || canvas.height * 0.55;
    const normY = Math.max(0, Math.min(1, (userBat.y - maxY) / 260));

    // Only transmit when local player actually moves paddle (or every 800ms keepalive)
    const now = performance.now();
    const moved =
      Math.abs(normX - this.lastSentNormX) > 0.0008 ||
      Math.abs(normY - this.lastSentNormY) > 0.0008;
    if (!moved && now - this.lastSentPaddleAt < 800) {
      return;
    }

    this.lastSentNormX = normX;
    this.lastSentNormY = normY;
    this.lastSentPaddleAt = now;

    this.net.sendFast({
      type: 'PADDLE_MOVE',
      normX,
      normY,
      seq: ++this.seq,
    });
  }

  /**
   * Updates extra bottom (teammate) and top (opponent) paddles for 2v2 and 4v4 modes,
   * including AI Teammate Bot returns and Extra AI Opponent Bot returns.
   */
  private updateExtraPaddles() {
    if (this.gameMode === '1v1') return;
    const canvas = window.canvas;
    const ball = window.ball;
    const userBat = window.userBat;
    const enemyBat = window.enemyBat;
    const tableTop = window.tableTop;
    if (!canvas || !ball || !userBat || !enemyBat || !tableTop) return;

    if (this.extraUserPaddles.length === 0 && this.getTeamSize() > 1) {
      this.initExtraPaddles();
    }

    const cx = canvas.width / 2;
    const maxY = userBat.maxY || canvas.height * 0.55;
    const now = performance.now();

    // 1. Update Extra Bottom (User Team) Paddles
    for (const p of this.extraUserPaddles) {
      if (p.isNetworkTeammate) {
        p.colorHex = this.remotePaddleColor;
        const targetX = cx + this.coopPartnerTargX;
        const targetY = Math.max(maxY, maxY + this.coopPartnerTargY * 250);
        p.x += (targetX - p.x) * 0.35;
        p.y += (targetY - p.y) * 0.35;
      } else {
        // AI Teammate Bot logic:
        // In 2v2, dynamically cover the opposite side of the table from userBat
        let desiredX = cx + p.laneOffsetX;
        if (this.gameMode === '2v2') {
          const userOffset = userBat.x - cx;
          desiredX = cx + (userOffset > 20 ? -120 : userOffset < -20 ? 120 : p.laneOffsetX);
        }
        let desiredY = canvas.height - 135;

        if (ball.lastHit === 'enemy' && ball.servingState >= 1 && !ball.offTable) {
          // Track incoming ball if it's closer to this bot or far from human userBat
          const distToLane = Math.abs(ball.x - desiredX);
          const distToHuman = Math.abs(ball.x - userBat.x);
          if (distToLane < 155 || distToHuman > 105) {
            desiredX = Math.max(cx - 240, Math.min(cx + 240, ball.x));
            desiredY = Math.max(maxY + 10, Math.min(canvas.height - 60, ball.y + 18));
          }
        }

        p.x += (desiredX - p.x) * 0.14;
        p.y += (desiredY - p.y) * 0.14;

        // Check if AI Teammate Bot can return the ball (if human userBat didn't hit it)
        const canBotHit =
          now - this.lastExtraBotHitAt > 280 &&
          ball.lastHit === 'enemy' &&
          ball.servingState >= 1 &&
          ball.bounceNum >= 1 &&
          ball.tablePosY > 0.5 &&
          Math.abs(userBat.x - ball.x) > 82 * userBat.scale &&
          Math.abs(p.x - ball.x) < 92 * p.scale &&
          Math.abs(p.y - (ball.y - ball.height * (ball.scale * 3) - 16)) < 95 * p.scale;

        if (canBotHit && (!this.isCoOpSameSide() || this.net.role === 'host')) {
          this.lastExtraBotHitAt = now;
          if (typeof window.playSound === 'function') {
            window.playSound('hit' + Math.floor(Math.random() * 6));
          }
          window.rallyHits = (window.rallyHits || 0) + 1;
          ball.servingState = 2;
          ball.bounceNum = 0;
          ball.lastHit = 'user';
          const hitData = {
            x: Math.max(-0.85, Math.min(0.85, (Math.random() - 0.5) * 1.3)),
            y: 0.15 + Math.random() * 0.2,
            speed: 0.42 + Math.random() * 0.14,
            spin: (Math.random() - 0.5) * 0.6,
          };
          ball.setBouncePoint(hitData);
          this.onLocalBallHit(ball, hitData, false);
        }
      }

      p.rotation = Math.max(-1.2, Math.min(1.2, (p.x - cx) / 200));
      p.scale = 0.47 + (p.y - maxY) / 500;
    }

    // 2. Update Extra Top (Enemy Team) Paddles
    const baseTopY = canvas.height / 4 + tableTop.offsetY * 50 - 45;
    for (const p of this.extraEnemyPaddles) {
      let desiredX = cx + p.laneOffsetX;
      let desiredY = baseTopY;

      if (ball.lastHit === 'user' && ball.servingState >= 1 && !ball.offTable) {
        const distToLane = Math.abs(ball.x - desiredX);
        if (distToLane < 150) {
          desiredX = Math.max(cx - 235, Math.min(cx + 235, ball.x));
          desiredY = baseTopY + Math.max(-15, Math.min(35, (ball.y - baseTopY) * 0.35));
        }
      }

      p.x += (desiredX - p.x) * 0.14;
      p.y += (desiredY - p.y) * 0.14;
      p.rotation = (p.x - cx) / 200;
      p.scale = 0.4 + (p.y - canvas.height / 4) / 300;

      // If top side is controlled by AI Bots (Solo mode or Co-Op Same-Side mode), allow extra top bots to return shots!
      const topSideIsBots = this.net.status !== 'connected' || this.isCoOpSameSide();
      if (
        topSideIsBots &&
        (this.net.status !== 'connected' || this.net.role === 'host') &&
        now - this.lastExtraBotHitAt > 280 &&
        ball.lastHit === 'user' &&
        ball.servingState >= 1 &&
        ball.bounceNum >= 1 &&
        ball.tablePosY < 0.5 &&
        ball.tablePosY > 0 &&
        Math.abs(p.x - ball.x) < 78 * p.scale &&
        Math.abs(p.y - (ball.y - ball.height * (ball.scale * 3) - 16)) < 78 * p.scale
      ) {
        this.lastExtraBotHitAt = now;
        if (typeof window.playSound === 'function') {
          window.playSound('hit' + Math.floor(Math.random() * 6));
        }
        window.rallyHits = (window.rallyHits || 0) + 1;
        ball.servingState = 2;
        ball.bounceNum = 0;
        ball.lastHit = 'enemy';
        const botHitData = enemyBat.getHitData(ball.tablePosX, ball.tablePosY);
        ball.setBouncePoint(botHitData);
        this.onEnemyBotBallHit(ball, botHitData, false);
      }
    }
  }

  /**
   * Renders extra bottom-side paddles (Co-Op Player 2 or AI Teammate Bots) in 2v2 and 4v4.
   */
  public renderExtraUserPaddles(ctx: CanvasRenderingContext2D, userBat: any) {
    if (this.gameMode === '1v1' || this.extraUserPaddles.length === 0) return;
    const canvas = window.canvas;
    const oImg = userBat?.oGameElementsImgData;
    const oIds = (window as any).oImageIds;
    if (!canvas || !oImg || !oIds) return;

    const centreData = oImg.oData.oAtlasData[oIds.userBatCentre];
    const edgeData = oImg.oData.oAtlasData[oIds.userBatEdge];

    for (const p of this.extraUserPaddles) {
      ctx.save();
      ctx.translate(p.x, p.y - 20 * p.scale);
      const scaleY =
        p.scale * Math.min(1 - ((p.y - canvas.height * 0.5) / (canvas.height * 0.5)) * 0.3, 1);
      ctx.scale(p.scale, scaleY);
      ctx.rotate(p.rotation);

      ctx.drawImage(
        oImg.img,
        centreData.x,
        centreData.y,
        centreData.width,
        centreData.height,
        -centreData.width / 2,
        -centreData.height / 3,
        centreData.width,
        centreData.height
      );

      ctx.rotate(-p.rotation);
      ctx.translate(
        0,
        Math.min(7 * Math.max((p.y - canvas.height * 0.5) / (canvas.height * 0.5), 0), 7)
      );
      ctx.rotate(p.rotation);

      this.drawTintedPaddleRubber(
        ctx,
        oImg.img,
        edgeData.x,
        edgeData.y,
        edgeData.width,
        edgeData.height,
        -edgeData.width / 2,
        -edgeData.height / 3 - 23,
        'user',
        p.colorHex
      );
      ctx.restore();

      // Tiny non-obstructive role tag under the handle
      ctx.save();
      ctx.font = '700 7px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(p.label, p.x + 1, p.y + 42 * p.scale + 1);
      ctx.fillStyle = p.isNetworkTeammate ? '#00f0ff' : '#ffe600';
      ctx.fillText(p.label, p.x, p.y + 42 * p.scale);
      ctx.restore();
    }
  }

  /**
   * Renders extra top-side paddles (AI Opponent Bots / Partner Bots) in 2v2 and 4v4.
   */
  public renderExtraEnemyPaddles(ctx: CanvasRenderingContext2D, enemyBat: any) {
    if (this.gameMode === '1v1' || this.extraEnemyPaddles.length === 0) return;
    const oImg = enemyBat?.oGameElementsImgData;
    const oIds = (window as any).oImageIds;
    if (!oImg || !oIds) return;

    const batData = oImg.oData.oAtlasData[oIds['enemyBat' + (enemyBat.id || 0)]];
    const edgeData = oImg.oData.oAtlasData[oIds.userBatEdge];

    for (const p of this.extraEnemyPaddles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.scale(p.scale, p.scale);
      ctx.drawImage(
        oImg.img,
        batData.x,
        batData.y,
        batData.width,
        batData.height,
        -batData.width / 2,
        -batData.height / 3,
        batData.width,
        batData.height
      );
      this.drawTintedPaddleRubber(
        ctx,
        oImg.img,
        edgeData.x,
        edgeData.y,
        edgeData.width,
        edgeData.height,
        -edgeData.width / 2,
        -edgeData.height / 3 - 23,
        'enemy',
        p.colorHex
      );
      ctx.restore();
    }
  }

  /**
   * Called when local `userBat` (or AI Teammate Bot) serves or returns the ball.
   */
  public onLocalBallHit(
    ball: any,
    hitData: { x: number; y: number; speed: number; spin: number },
    isServe: boolean
  ) {
    if (this.net.status !== 'connected') return;

    const packet: BallHitPacket = {
      type: 'BALL_HIT',
      isServe,
      coOpSameSide: this.isCoOpSameSide(),
      tablePosX: ball.tablePosX,
      tablePosY: ball.tablePosY,
      height: ball.height,
      hitData: {
        x: hitData.x,
        y: hitData.y,
        speed: hitData.speed,
        spin: hitData.spin,
      },
      rallyHits: window.rallyHits || 0,
    };

    this.net.sendReliable(packet);
  }

  /**
   * Called when an AI Bot on the top side serves or returns the ball.
   * In Co-Op Same-Side mode, Host broadcasts the bot's shot so Guest stays 100% synced.
   */
  public onEnemyBotBallHit(
    ball: any,
    hitData: { x: number; y: number; speed: number; spin: number },
    isServe: boolean
  ) {
    if (!this.isCoOpSameSide() || this.net.role !== 'host') return;

    const packet: BallHitPacket = {
      type: 'BALL_HIT',
      isServe,
      fromEnemyBot: true,
      tablePosX: ball.tablePosX,
      tablePosY: ball.tablePosY,
      height: ball.height,
      hitData: {
        x: hitData.x,
        y: hitData.y,
        speed: hitData.speed,
        spin: hitData.spin,
      },
      rallyHits: window.rallyHits || 0,
    };

    this.net.sendReliable(packet);
  }

  /**
   * Handles point termination in multiplayer so Host and Guest never desync scores.
   */
  public handleBallOut(ball: any, reason: 'off_table' | 'bottom_out'): boolean {
    if (this.net.status !== 'connected') {
      return false; // Let default single-player logic handle it
    }

    const now = performance.now();
    if (now - this.lastPointProcessedAt < 650) {
      return true; // Debounce duplicate out triggers during same rally end
    }

    if (this.net.role === 'host') {
      this.lastPointProcessedAt = now;
      let winnerRole: 'host' | 'guest';

      if (reason === 'off_table') {
        if (ball.lastHit === 'user') {
          winnerRole = ball.bounceNum === 0 ? 'guest' : 'host';
        } else {
          winnerRole = ball.bounceNum === 0 ? 'host' : 'guest';
        }
      } else {
        // bottom_out on Host's side
        winnerRole = ball.bounceNum > 0 || ball.ballShortState > 0 ? 'guest' : 'host';
      }

      this.commitAndBroadcastPoint(winnerRole);
      return true;
    } else {
      // Guest notifies Host when ball goes out on Guest's screen
      this.lastPointProcessedAt = now;
      const missPacket: BallMissPacket = {
        type: 'BALL_MISS',
        reason,
        lastHit: ball.lastHit,
        bounceNum: ball.bounceNum,
        ballShortState: ball.ballShortState,
      };
      this.net.sendReliable(missPacket);
      // Pause ball locally until Host's authoritative POINT_RESULT arrives
      ball.resetServe(ball.serveFlip ? 'user' : 'enemy');
      return true;
    }
  }

  private commitAndBroadcastPoint(winnerRole: 'host' | 'guest') {
    const oGameData = window.oGameData;
    const ball = window.ball;
    if (!oGameData || !ball) return;

    const localWinner = winnerRole === 'host' ? 'user' : 'enemy';
    window.updateScore(localWinner);

    const totalPoints = oGameData.userScore + oGameData.enemyScore;
    if (totalPoints % 2 === 0 || (oGameData.userScore >= 10 && oGameData.enemyScore >= 10)) {
      ball.serveFlip = !ball.serveFlip;
    }

    const nextServerRole: 'host' | 'guest' = ball.serveFlip ? 'host' : 'guest';
    ball.resetServe(nextServerRole === 'host' ? 'user' : 'enemy');

    const pkt: PointResultPacket = {
      type: 'POINT_RESULT',
      hostScore: oGameData.userScore,
      guestScore: oGameData.enemyScore,
      pointWinner: winnerRole,
      nextServer: nextServerRole,
      serveFlip: ball.serveFlip,
      rallyHits: window.rallyHits || 0,
    };
    this.net.sendReliable(pkt);
  }

  private handlePacket(packet: GamePacket) {
    if (packet.type === 'LOBBY_UPDATE') {
      if (packet.gameMode && (this.net.role === 'guest' || packet.senderRole === 'host')) {
        this.gameMode = packet.gameMode;
      }
      if (packet.guestSide) {
        this.guestSide = packet.guestSide;
      }
      if (packet.mapId && ARENA_MAPS.some((m) => m.id === packet.mapId)) {
        if (this.net.role === 'guest' || packet.senderRole === 'host') {
          this.selectedMapId = packet.mapId;
          this.applyMapToActiveGame();
        }
      }
      if (packet.paddleColor && PADDLE_COLORS.some((c) => c.hex === packet.paddleColor)) {
        this.remotePaddleColor = packet.paddleColor;
      }
      this.notifyLobbyListeners();
      return;
    }

    if (packet.type === 'MATCH_START' || packet.type === 'MATCH_REMATCH') {
      if (packet.gameMode) {
        this.gameMode = packet.gameMode;
      }
      if (packet.guestSide) {
        this.guestSide = packet.guestSide;
      }
      if (packet.mapId && ARENA_MAPS.some((m) => m.id === packet.mapId)) {
        this.selectedMapId = packet.mapId;
        this.applyMapToActiveGame();
      }
      if (this.net.role === 'guest' && packet.hostPaddleColor) {
        this.remotePaddleColor = packet.hostPaddleColor;
      } else if (this.net.role === 'host' && packet.guestPaddleColor) {
        this.remotePaddleColor = packet.guestPaddleColor;
      }
      this.notifyLobbyListeners();
      this.startMultiplayerMatch(false);
      return;
    }

    if (packet.type === 'MATCH_FORFEIT') {
      // Opponent forfeited! Local player automatically wins match!
      if (window.oGameData) {
        window.oGameData.userScore = 11;
        window.oGameData.enemyScore = Math.min(window.oGameData.enemyScore || 0, 10);
      }
      if (typeof window.initGameComplete === 'function') {
        window.initGameComplete();
      }
      return;
    }

    if (packet.type === 'PEER_PAUSED') {
      this.peerPaused = Boolean(packet.paused);
      return;
    }

    if (packet.type === 'PADDLE_MOVE') {
      if (this.isCoOpSameSide()) {
        // Same-side Co-Op teammate! Do NOT mirror X
        this.coopPartnerTargX = packet.normX * 250;
        this.coopPartnerTargY = packet.normY;
        return;
      }
      const enemyBat = window.enemyBat;
      if (!enemyBat) return;
      enemyBat.controlMode = 'NETWORK_MODE';
      // Mirror X across the table so Player 2's right is Player 1's left
      enemyBat.networkTargX = -packet.normX * 250;
      enemyBat.networkTargY = (1 - packet.normY) * 45 - 15;
      return;
    }

    if (packet.type === 'BALL_HIT') {
      const ball = window.ball;
      const enemyBat = window.enemyBat;
      if (!ball || !enemyBat) return;

      window.rallyHits = packet.rallyHits;
      if (typeof window.playSound === 'function') {
        window.playSound('hit' + Math.floor(Math.random() * 6));
      }

      if (packet.fromEnemyBot) {
        // In Co-Op Same-Side mode, Host sent the AI Bot's shot from the top side
        ball.offTable = false;
        ball.offSide = false;
        ball.ballShortState = 0;
        ball.bounceNum = 0;
        ball.lastHit = 'enemy';
        ball.tablePosX = packet.tablePosX;
        ball.tablePosY = packet.tablePosY;
        ball.height = Math.max(14, packet.height || 18);
        ball.servingState = 2;
        ball.setBouncePoint(packet.hitData);
        return;
      }

      if (packet.coOpSameSide) {
        // In Co-Op Same-Side mode, our human partner on the bottom side hit the ball toward the AI Bots!
        ball.offTable = false;
        ball.offSide = false;
        ball.ballShortState = 0;
        ball.bounceNum = 0;
        ball.lastHit = 'user';
        ball.tablePosX = packet.tablePosX;
        ball.tablePosY = packet.tablePosY;
        ball.height = Math.max(14, packet.height || 18);
        ball.servingState = 2;
        ball.setBouncePoint(packet.hitData);
        return;
      }

      // Reset state for new incoming trajectory from opposite-side opponent
      ball.offTable = false;
      ball.offSide = false;
      ball.ballShortState = 0;
      ball.bounceNum = 0;
      ball.lastHit = 'enemy';
      ball.tablePosX = -packet.tablePosX;
      ball.tablePosY = packet.isServe ? 0.2 : Math.max(0.05, Math.min(0.48, 1.0 - packet.tablePosY));
      ball.height = Math.max(14, packet.height || 18);
      // Crucial: Set servingState = 2 so receiving player's bat can hit ball after first bounce on their side!
      ball.servingState = 2;

      const mirroredHitData = {
        x: -packet.hitData.x,
        // Map userBat target Y [0..0.4] (top half) to enemyBat target Y [0.65..1.05] (bottom half)
        y: Math.max(0.62, Math.min(1.02, 1.02 - packet.hitData.y)),
        speed: packet.hitData.speed,
        spin: -packet.hitData.spin,
      };

      enemyBat.lastNetworkHitData = mirroredHitData;
      ball.setBouncePoint(mirroredHitData);
      return;
    }

    if (packet.type === 'BALL_MISS' && this.net.role === 'host') {
      const now = performance.now();
      if (now - this.lastPointProcessedAt < 500) return;
      this.lastPointProcessedAt = now;

      let winnerRole: 'host' | 'guest';
      if (this.isCoOpSameSide()) {
        // Same perspective on Guest & Host in Co-Op mode ('host' = Co-Op Team, 'guest' = Enemy Bots)
        if (packet.reason === 'bottom_out') {
          winnerRole = packet.bounceNum > 0 || packet.ballShortState > 0 ? 'guest' : 'host';
        } else {
          winnerRole =
            packet.lastHit === 'user'
              ? packet.bounceNum === 0
                ? 'guest'
                : 'host'
              : packet.bounceNum === 0
              ? 'host'
              : 'guest';
        }
      } else {
        // Evaluate from Guest's perspective: on Guest's screen, 'user' is Guest and 'enemy' is Host
        if (packet.reason === 'bottom_out') {
          winnerRole = packet.bounceNum > 0 || packet.ballShortState > 0 ? 'host' : 'guest';
        } else {
          if (packet.lastHit === 'user') {
            winnerRole = packet.bounceNum === 0 ? 'host' : 'guest';
          } else {
            winnerRole = packet.bounceNum === 0 ? 'guest' : 'host';
          }
        }
      }

      this.commitAndBroadcastPoint(winnerRole);
      return;
    }

    if (packet.type === 'POINT_RESULT' && this.net.role === 'guest') {
      this.lastPointProcessedAt = performance.now();
      const oGameData = window.oGameData;
      const ball = window.ball;
      if (!oGameData || !ball) return;

      if (this.isCoOpSameSide()) {
        // In Co-Op Same-Side mode, 'host' score is the shared User Team score, 'guest' score is Enemy Bot score!
        oGameData.userScore = packet.hostScore - (packet.pointWinner === 'host' ? 1 : 0);
        oGameData.enemyScore = packet.guestScore - (packet.pointWinner === 'guest' ? 1 : 0);

        const localWinner = packet.pointWinner === 'host' ? 'user' : 'enemy';
        window.updateScore(localWinner);

        oGameData.userScore = packet.hostScore;
        oGameData.enemyScore = packet.guestScore;

        ball.serveFlip = packet.serveFlip;
        const localNextServer = packet.nextServer === 'host' ? 'user' : 'enemy';
        ball.resetServe(localNextServer);
        return;
      }

      // Set exact synchronized scores for opposite-side match
      oGameData.userScore = packet.guestScore - (packet.pointWinner === 'guest' ? 1 : 0);
      oGameData.enemyScore = packet.hostScore - (packet.pointWinner === 'host' ? 1 : 0);

      const localWinner = packet.pointWinner === 'guest' ? 'user' : 'enemy';
      window.updateScore(localWinner);

      oGameData.userScore = packet.guestScore;
      oGameData.enemyScore = packet.hostScore;

      ball.serveFlip = !packet.serveFlip;
      const localNextServer = packet.nextServer === 'guest' ? 'user' : 'enemy';
      ball.resetServe(localNextServer);
      return;
    }
  }

  /**
   * Returns opponent's PlayerIdentity (Remote Player in Versus lobby, or AI Bot in Solo / Co-Op Same-Side mode).
   */
  public getOpponentIdentity(): PlayerIdentity {
    if (this.net.remotePlayer && !this.isCoOpSameSide()) {
      return this.net.remotePlayer;
    }
    return BOT_PROFILE;
  }

  /**
   * Renders the retro arcade start marquee for "PONGPONG" directly onto the canvas.
   */
  /**
   * The start screen is handled entirely by the Vinyl Halftone Preloader & Pre-Game Lobby.
   * Suppress legacy canvas title marquee rendering so it never flashes or draws on the canvas.
   */
  public renderStartTitle(_ctx: CanvasRenderingContext2D, _panel: any) {
    return;
  }

  /**
   * Paddle identity renders: Keep active gameplay clean and unobstructed!
   * The player's identity and score are already rendered on the top scoreboard.
   * Floating badges directly over the paddles are suppressed during rallies to keep the ball sightline clear.
   */
  public renderUserIdentity(_ctx: CanvasRenderingContext2D, _bat: any) {
    // Intentionally no-op to maintain zero gameplay obstruction
  }

  /**
   * Opponent identity is displayed on the top scoreboard. Suppressing floating
   * badges over the enemy bat prevents obscuring the ball near the net/baseline.
   */
  public renderEnemyIdentity(_ctx: CanvasRenderingContext2D, _bat: any) {
    // Intentionally no-op to maintain zero gameplay obstruction
  }

  /**
   * Replaces top country flags in `case "game"` with retro arcade chips: 1P vs 2P / BOT.
   */
  public renderTopScoreboardAvatars(ctx: CanvasRenderingContext2D, panel: any) {
    const canvas = window.canvas;
    if (!canvas || !panel) return;

    const localUser = this.auth.getUser();
    const opponent = this.getOpponentIdentity();
    const isCoOp = this.isCoOpSameSide();
    const isVersusPeer = Boolean(this.net.remotePlayer) && !isCoOp;
    const posY = panel.posY || 0;
    const centerY = 30 - posY;

    const leftBadge =
      this.gameMode === '1v1' ? '1P' : isCoOp ? 'COOP' : this.gameMode.toUpperCase();
    const rightBadge =
      this.gameMode === '1v1'
        ? isVersusPeer
          ? '2P'
          : 'BOT'
        : isVersusPeer
        ? '2P+'
        : `${this.getTeamSize()}BOT`;

    // Left slot (User Team)
    this.drawTopPfpSlot(
      ctx,
      canvas.width / 2 - 58,
      centerY,
      localUser,
      '#00f0ff',
      leftBadge,
      'left'
    );

    // Right slot (Opponent Team)
    this.drawTopPfpSlot(
      ctx,
      canvas.width / 2 + 58,
      centerY,
      opponent,
      isVersusPeer ? '#ff007f' : '#ff9900',
      rightBadge,
      'right'
    );
  }

  /**
   * Replaces country flags on `gameIntro` (VS screen) & `gameComplete` (Match Over screen)
   * with retro arcade cards, marquee headers, and LED score displays.
   */
  public renderIntroOrCompleteAvatars(
    ctx: CanvasRenderingContext2D,
    panel: any,
    screenType: 'gameIntro' | 'gameComplete'
  ) {
    const canvas = window.canvas;
    if (!canvas || !panel) return;

    // On gameComplete, our modern Match Results Screen (#ttwt-gameover-screen) handles all UI:
    // hide legacy canvas next/back buttons and skip legacy 2D canvas text/cards.
    if (screenType === 'gameComplete') {
      try {
        if (Array.isArray(panel.aButs)) {
          for (const b of panel.aButs) {
            if (b && b.id !== (window as any).oImageIds?.muteBut0 && b.id !== (window as any).oImageIds?.muteBut1) {
              b.scale = 0.0001;
            }
          }
        }
        const ui = (window as any).userInput;
        if (ui && typeof ui.removeHitArea === 'function') {
          ui.removeHitArea('nextFromGameComplete');
          ui.removeHitArea('backFromGameComplete');
        }
      } catch {}
      return;
    }

    const localUser = this.auth.getUser();
    const opponent = this.getOpponentIdentity();
    const isCoOp = this.isCoOpSameSide();
    const isMultiplayer = Boolean(this.net.remotePlayer) && !isCoOp;
    const posY = panel.posY || 0;
    const cx = canvas.width / 2;

    const centerY = canvas.height * 0.48 - posY / 4;
    const leftX = cx - 128;
    const rightX = cx + 128;

    ctx.save();
    // Top Header
    const headerY = canvas.height * 0.22 - posY / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const bannerText = `★ ${this.gameMode.toUpperCase()} ARCADE BRAWL ★`;
    ctx.font = '900 22px "Press Start 2P", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(bannerText, cx + 3, headerY + 3);
    ctx.fillStyle = '#ff007f';
    ctx.fillText(bannerText, cx + 1, headerY + 1);
    ctx.fillStyle = '#ffe600';
    ctx.fillText(bannerText, cx, headerY);

    ctx.font = '700 10px "Press Start 2P", monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('FIRST TO 11 POINTS WINS', cx, headerY + 32);

    // Chunky VS Box in Center
    const vsY = centerY;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 28, vsY - 18, 56, 36);
    ctx.fillStyle = '#ffe600';
    ctx.fillRect(cx - 30, vsY - 20, 60, 40);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(cx - 30, vsY - 20, 60, 40);

    ctx.font = '900 16px "Press Start 2P", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText('VS', cx, vsY + 1);

    // Bottom Prompt (Positioned safely above play button at 0.85)
    const time = performance.now();
    if (Math.floor(time / 500) % 2 === 0) {
      ctx.font = '700 11px "Press Start 2P", monospace';
      const promptY = Math.round(canvas.height * 0.70);
      ctx.fillStyle = '#000000';
      ctx.fillText('► PRESS PLAY TO SERVE ◄', cx + 2, promptY + 2);
      ctx.fillStyle = '#ffe600';
      ctx.fillText('► PRESS PLAY TO SERVE ◄', cx, promptY);
    }
    ctx.restore();

    // 1P Card
    this.drawLargeMatchPfpCard(ctx, leftX, centerY, localUser, '#00f0ff', '1P', false);

    // 2P / BOT Card
    this.drawLargeMatchPfpCard(
      ctx,
      rightX,
      centerY,
      opponent,
      isMultiplayer ? '#ff007f' : '#ff9900',
      isMultiplayer ? '2P' : 'BOT',
      false
    );
  }

  /**
   * Renders the retro arcade pause screen overlay.
   */
  public renderPauseScreen(ctx: CanvasRenderingContext2D, _panel: any) {
    const canvas = window.canvas;
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.42;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const title = 'PAUSED';
    ctx.font = '900 44px "Press Start 2P", monospace';
    // 3D Shadow
    for (let s = 5; s >= 1; s--) {
      ctx.fillStyle = s > 2 ? '#000000' : '#ff007f';
      ctx.fillText(title, cx + s * 2, cy + s * 2);
    }
    ctx.fillStyle = '#ffe600';
    ctx.fillText(title, cx, cy);

    ctx.font = '700 11px "Press Start 2P", monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('CLICK PLAY OR HIT ESC TO RESUME', cx, cy + 50);

    ctx.restore();
  }

  /**
   * Renders persistent overlays such as the AFK / Tab Switch Warning.
   */
  public renderPanelOverlay(ctx: CanvasRenderingContext2D, _panel: any) {
    if (this.peerPaused && this.net.status === 'connected') {
      const canvas = window.canvas;
      if (!canvas) return;

      ctx.save();
      const cx = canvas.width / 2;
      const cy = canvas.height * 0.44;

      const w = Math.min(canvas.width - 40, 420);
      const h = 76;

      // Hard 3D Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - w / 2 + 5, cy - h / 2 + 5, w, h);

      // Box body (Flashing arcade yellow/pink)
      const flash = Math.floor(performance.now() / 400) % 2 === 0;
      ctx.fillStyle = flash ? '#ffe600' : '#ff007f';
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);

      // Text lines
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 12px "Press Start 2P", monospace';
      ctx.fillStyle = '#000000';
      ctx.fillText('⚠️ OPPONENT TABBED OUT / AFK ⚠️', cx, cy - 14);

      ctx.font = '700 9px "Press Start 2P", monospace';
      ctx.fillText('WAITING FOR 2P TO RETURN TO TAB...', cx, cy + 12);

      ctx.restore();
    }
  }

  private drawFloatingPlayerTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    player: PlayerIdentity,
    accentColor: string,
    scale: number
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    const label = (player.displayName || player.username).toUpperCase().slice(0, 12);
    ctx.font = '700 10px "Press Start 2P", monospace';
    const textWidth = ctx.measureText(label).width;
    const avatarSize = 22;
    const padX = 8;
    const pillWidth = avatarSize + 6 + textWidth + padX * 2;
    const pillHeight = 28;

    // Hard 3D Shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(-pillWidth / 2 + 3, -pillHeight / 2 + 3, pillWidth, pillHeight);

    // Pill background
    ctx.fillStyle = '#150d2a';
    ctx.fillRect(-pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = accentColor;
    ctx.strokeRect(-pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight);

    // Avatar square
    const avatarCenterX = -pillWidth / 2 + padX + avatarSize / 2;
    const img = this.auth.preloadAvatar(player.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.rect(avatarCenterX - avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, avatarCenterX - avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || '#ff007f';
      ctx.fillRect(avatarCenterX - avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
    }
    ctx.restore();

    // Username text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, avatarCenterX + avatarSize / 2 + 6, 1);

    ctx.restore();
  }

  private drawBotTag(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.font = '700 9px "Press Start 2P", monospace';
    const label = 'AI BOT';
    const w = ctx.measureText(label).width + 16;
    const h = 22;

    // 3D Shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);
    ctx.fillStyle = '#150d2a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff9900';
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    ctx.fillStyle = '#ff9900';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 1);
    ctx.restore();
  }

  private drawTopPfpSlot(
    ctx: CanvasRenderingContext2D,
    edgeX: number,
    centerY: number,
    player: PlayerIdentity,
    chipColor: string,
    roleTag: string,
    side: 'left' | 'right'
  ) {
    ctx.save();
    const label = (player.displayName || player.username).toUpperCase().slice(0, 8);
    ctx.font = '700 9px "Press Start 2P", monospace';
    const textW = Math.min(ctx.measureText(label).width, 80);
    const avatarSize = 30;
    const pillH = 38;
    const pillW = avatarSize + textW + 36;

    const pillX = side === 'left' ? edgeX - pillW : edgeX;
    const pillY = centerY - pillH / 2;

    // Hard 3D Drop Shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(pillX + 3, pillY + 3, pillW, pillH);

    // Pill chassis
    ctx.fillStyle = '#150d2a';
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = chipColor;
    ctx.strokeRect(pillX, pillY, pillW, pillH);

    // Role Tag (1P / 2P / BOT)
    const tagW = 20;
    const tagH = 14;
    const tagX = side === 'left' ? pillX + 4 : pillX + pillW - tagW - 4;
    const tagY = pillY + 4;
    ctx.fillStyle = chipColor;
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.font = '900 7px "Press Start 2P", monospace';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleTag, tagX + tagW / 2, tagY + tagH / 2 + 1);

    // Avatar
    const avatarCx = side === 'left' ? edgeX - 6 - avatarSize / 2 : edgeX + 6 + avatarSize / 2;
    const img = this.auth.preloadAvatar(player.avatarUrl);

    ctx.save();
    ctx.beginPath();
    ctx.rect(avatarCx - avatarSize / 2, centerY - avatarSize / 2, avatarSize, avatarSize);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, avatarCx - avatarSize / 2, centerY - avatarSize / 2, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || chipColor;
      ctx.fillRect(avatarCx - avatarSize / 2, centerY - avatarSize / 2, avatarSize, avatarSize);
    }
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(avatarCx - avatarSize / 2, centerY - avatarSize / 2, avatarSize, avatarSize);

    // Username
    ctx.font = '700 8px "Press Start 2P", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    if (side === 'left') {
      ctx.textAlign = 'right';
      ctx.fillText(label, avatarCx - avatarSize / 2 - 6, centerY + 1, 80);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(label, avatarCx + avatarSize / 2 + 6, centerY + 1, 80);
    }

    ctx.restore();
  }

  private drawLargeMatchPfpCard(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    player: PlayerIdentity,
    accentColor: string,
    roleTag: '1P' | '2P' | 'BOT',
    isWinner = false
  ) {
    ctx.save();
    const cardW = 106;
    const cardH = 126;
    const avatarSize = 72;
    const label = (player.displayName || player.username).toUpperCase().slice(0, 10);

    // Hard 3D Drop Shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(centerX - cardW / 2 + 5, centerY - cardH / 2 + 5, cardW, cardH);

    // Card background
    ctx.fillStyle = '#150d2a';
    ctx.fillRect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH);
    ctx.lineWidth = isWinner ? 4 : 3;
    ctx.strokeStyle = accentColor;
    ctx.strokeRect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH);

    // Role Tag chip at top
    const tagW = 34;
    const tagH = 16;
    ctx.fillStyle = accentColor;
    ctx.fillRect(centerX - tagW / 2, centerY - cardH / 2 + 4, tagW, tagH);
    ctx.font = '900 8px "Press Start 2P", monospace';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleTag, centerX, centerY - cardH / 2 + 12);

    // Avatar square
    const avatarCy = centerY - 2;
    const img = this.auth.preloadAvatar(player.avatarUrl);

    ctx.save();
    ctx.beginPath();
    ctx.rect(centerX - avatarSize / 2, avatarCy - avatarSize / 2, avatarSize, avatarSize);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, centerX - avatarSize / 2, avatarCy - avatarSize / 2, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || accentColor;
      ctx.fillRect(centerX - avatarSize / 2, avatarCy - avatarSize / 2, avatarSize, avatarSize);
    }
    ctx.restore();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(centerX - avatarSize / 2, avatarCy - avatarSize / 2, avatarSize, avatarSize);

    // Winner Crown icon
    if (isWinner) {
      ctx.font = '16px serif';
      ctx.fillText('👑', centerX, avatarCy - avatarSize / 2 - 4);
    }

    // Username
    ctx.font = '700 8px "Press Start 2P", monospace';
    ctx.fillStyle = isWinner ? '#ffe600' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, centerX, centerY + cardH / 2 - 14, 95);

    ctx.restore();
  }

  /**
   * High-DPI Neo-Brutalist & Retro Arcade Vector Button Renderer
   * Replaces blurry 2012 bitmap sprites with sharp, high-voltage vector buttons:
   * - Play button ("id0"): Slanted arcade gold capsule with 3D bevel and crisp white triangle
   * - Mute button ("id3" unmuted, "id2" muted): Cyan / Ruby arcade tokens with sharp speaker glyph
   * - Back button ("id4"): Hot Magenta arcade token with iconic retro turn-back arrow
   * Returns true if custom rendered (bypassing default ctx.drawImage in app.js).
   */
  public drawCustomButton(
    ctx: CanvasRenderingContext2D,
    but: any,
    cx: number,
    cy: number,
    _bWidth: number,
    _bHeight: number,
    scale: number = 1
  ): boolean {
    if (!but || !but.id) return false;
    const id = but.id;

    const isPlay = id === 'id0';
    const isMuteOff = id === 'id3'; // Unmuted (sound enabled)
    const isMuteOn = id === 'id2';  // Muted
    const isBack = id === 'id4';
    const isPause = id === 'id8';
    const isRestart = id === 'id6';

    if (!isPlay && !isMuteOff && !isMuteOn && !isBack && !isPause && !isRestart) {
      return false;
    }

    ctx.save();
    ctx.translate(cx, cy);
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }

    // ==========================================
    // 1. PLAY BUTTON ("id0") - Slanted Gold Capsule
    // ==========================================
    if (isPlay) {
      const w = 186;
      const h = 66;
      const r = 24;

      ctx.save();
      // Brawlhalla-style energetic slanted angle
      ctx.transform(1, 0, -0.09, 1, 0, 0);

      // 1. Heavy Black Drop Shadow
      ctx.fillStyle = '#000000';
      drawButtonRoundRect(ctx, -w / 2 + 5, -h / 2 + 7, w, h, r);
      ctx.fill();

      // 2. 3D Bottom Extrusion Lip
      ctx.fillStyle = '#c47100';
      drawButtonRoundRect(ctx, -w / 2, -h / 2 + 5, w, h, r);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // 3. Vibrant Top Face Gradient
      const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, '#fff368');
      grad.addColorStop(0.35, '#ffe600');
      grad.addColorStop(0.85, '#ffad00');
      grad.addColorStop(1, '#ff9100');
      ctx.fillStyle = grad;
      drawButtonRoundRect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fill();

      // 4. Crisp Black Border
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // 5. Glass Sheen on Top Half
      ctx.save();
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h * 0.44);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
      drawButtonRoundRect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, r - 2);
      ctx.fill();
      ctx.restore();

      // 6. Bold White Play Triangle (▶)
      ctx.save();
      // Triangle Shadow
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(-11 + 2, -18 + 3);
      ctx.lineTo(19 + 2, 0 + 3);
      ctx.lineTo(-11 + 2, 18 + 3);
      ctx.closePath();
      ctx.fill();

      // Triangle Face
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-11, -18);
      ctx.lineTo(19, 0);
      ctx.lineTo(-11, 18);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#000000';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      // 7. Mini Sparkle Star
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      const sx = -w / 2 + 22;
      const sy = -h / 2 + 15;
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore(); // restore transform
      ctx.restore(); // restore translate/scale
      return true;
    }

    // ==========================================
    // 2. BACK BUTTON ("id4") - Hot Magenta Token
    // ==========================================
    if (isBack) {
      const r = 24;

      // 1. Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(3.5, 5, r, 0, Math.PI * 2);
      ctx.fill();

      // 2. 3D Bottom Lip Bevel
      ctx.fillStyle = '#6b0036';
      ctx.beginPath();
      ctx.arc(0, 4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // 3. Face Gradient
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, '#ff3b99');
      grad.addColorStop(0.5, '#ff007f');
      grad.addColorStop(1, '#ba005c');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // 4. Black Border
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // 5. Top Inner Highlight Ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, -1, r - 3, Math.PI * 0.85, Math.PI * 1.85);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 6. Iconic Sharp Retro Turn-Back Arrow (↵)
      ctx.save();
      const drawArrow = (ox: number, oy: number, fill: string, stroke?: string) => {
        ctx.beginPath();
        // Arrow head pointing left
        ctx.moveTo(-10 + ox, 0 + oy);
        ctx.lineTo(-2 + ox, -8 + oy);
        ctx.lineTo(-2 + ox, -3 + oy);
        // Horizontal bar
        ctx.lineTo(6 + ox, -3 + oy);
        // Turn-up vertical hook
        ctx.lineTo(6 + ox, -8 + oy);
        ctx.lineTo(10 + ox, -8 + oy);
        ctx.lineTo(10 + ox, 3 + oy);
        ctx.lineTo(-2 + ox, 3 + oy);
        ctx.lineTo(-2 + ox, 8 + oy);
        ctx.closePath();

        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
      };

      // Shadow
      drawArrow(1.5, 2.5, '#000000');
      // White Face
      drawArrow(0, 0, '#ffffff', '#000000');
      ctx.restore();

      ctx.restore();
      return true;
    }

    // ==========================================
    // 3. MUTE BUTTON ("id3" unmuted, "id2" muted)
    // ==========================================
    if (isMuteOff || isMuteOn) {
      const r = 24;

      // 1. Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(3.5, 5, r, 0, Math.PI * 2);
      ctx.fill();

      if (isMuteOff) {
        // UNMUTED: Neon Cyan Arcade Token
        // 2. 3D Bottom Lip Bevel
        ctx.fillStyle = '#005973';
        ctx.beginPath();
        ctx.arc(0, 4, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // 3. Face Gradient
        const grad = ctx.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#5effff');
        grad.addColorStop(0.5, '#00f0ff');
        grad.addColorStop(1, '#009bb8');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // 4. Black Border
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // 5. Highlight Ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, -1, r - 3, Math.PI * 0.85, Math.PI * 1.85);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // 6. Crisp Speaker Glyph + Sound Waves
        ctx.save();
        const drawSpeakerCone = (ox: number, oy: number, fill: string, stroke?: string) => {
          ctx.beginPath();
          // Body rect
          ctx.rect(-11 + ox, -5 + oy, 5, 10);
          // Bell trapezoid
          ctx.moveTo(-6 + ox, -5 + oy);
          ctx.lineTo(0 + ox, -10 + oy);
          ctx.lineTo(0 + ox, 10 + oy);
          ctx.lineTo(-6 + ox, 5 + oy);
          ctx.closePath();

          ctx.fillStyle = fill;
          ctx.fill();
          if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.5;
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        };

        // Shadow
        drawSpeakerCone(1.5, 2, '#000000');
        // Face
        drawSpeakerCone(0, 0, '#ffffff', '#000000');

        // Sound wave 1 (inner)
        ctx.beginPath();
        ctx.arc(0, 0, 6, -Math.PI * 0.32, Math.PI * 0.32);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(-0.5, -0.5, 6, -Math.PI * 0.32, Math.PI * 0.32);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Sound wave 2 (outer)
        ctx.beginPath();
        ctx.arc(0, 0, 11, -Math.PI * 0.36, Math.PI * 0.36);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(-0.5, -0.5, 11, -Math.PI * 0.36, Math.PI * 0.36);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();

      } else {
        // MUTED: Dark Cabinet Token with Red Strike-Through
        // 2. 3D Bottom Lip Bevel
        ctx.fillStyle = '#140c24';
        ctx.beginPath();
        ctx.arc(0, 4, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // 3. Face Gradient
        const grad = ctx.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#2b193d');
        grad.addColorStop(1, '#130a1c');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // 4. Red Warning Border
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#ff0055';
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // 5. Speaker in Dimmed White
        ctx.save();
        ctx.beginPath();
        ctx.rect(-10, -5, 5, 10);
        ctx.moveTo(-5, -5);
        ctx.lineTo(1, -10);
        ctx.lineTo(1, 10);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // 6. Bold Strike-Through Slash (\)
        ctx.beginPath();
        ctx.moveTo(-11, -11);
        ctx.lineTo(11, 11);
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-11, -11);
        ctx.lineTo(11, 11);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#ff0055';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(10, 10);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
      return true;
    }

    // ==========================================
    // 4. PAUSE BUTTON ("id8")
    // ==========================================
    if (isPause) {
      const r = 24;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(3.5, 5, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#4a1575';
      ctx.beginPath();
      ctx.arc(0, 4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, '#9333ea');
      grad.addColorStop(1, '#6b21a8');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // Pause bars ❚❚
      ctx.fillStyle = '#000000';
      ctx.fillRect(-7 + 1.5, -9 + 2, 5, 18);
      ctx.fillRect(2 + 1.5, -9 + 2, 5, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7, -9, 5, 18);
      ctx.fillRect(2, -9, 5, 18);

      ctx.restore();
      return true;
    }

    // ==========================================
    // 5. RESTART BUTTON ("id6")
    // ==========================================
    if (isRestart) {
      const r = 24;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(3.5, 5, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#a84c00';
      ctx.beginPath();
      ctx.arc(0, 4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, '#ff9900');
      grad.addColorStop(1, '#d96500');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // Circular refresh arrow ⟳
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 10, -Math.PI * 0.7, Math.PI * 0.9);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Arrow head on arc
      ctx.beginPath();
      ctx.moveTo(8, -8);
      ctx.lineTo(13, -1);
      ctx.lineTo(5, -1);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      ctx.restore();
      return true;
    }

    ctx.restore();
    return false;
  }
}

/** Helper: Universal rounded rectangle path compatible with all canvas contexts */
function drawButtonRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
