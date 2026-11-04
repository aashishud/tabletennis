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
   * Forfeits the current match and exits to the main menu start screen.
   * In multiplayer, sends a MATCH_FORFEIT packet so the opponent is awarded the win.
   */
  public forfeitOrExitMatch() {
    if (this.net.status === 'connected' && !this.isCoOpSameSide()) {
      this.net.sendReliable({
        type: 'MATCH_FORFEIT',
        by: this.net.role,
      });
      if (window.oGameData) {
        window.oGameData.userScore = Math.min(window.oGameData.userScore || 0, 10);
        window.oGameData.enemyScore = 11;
      }
      if (typeof window.initGameComplete === 'function') {
        window.initGameComplete();
      } else if (typeof window.initStartScreen === 'function') {
        window.initStartScreen();
      }
      return;
    }

    // In single player vs Bot or Co-Op vs Bot:
    this.setMode('BOT_MODE');
    if (typeof window.initStartScreen === 'function') {
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
  public renderStartTitle(ctx: CanvasRenderingContext2D, panel: any) {
    const canvas = window.canvas;
    if (!canvas) return;
    const posY = panel ? panel.posY || 0 : 0;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.21 - posY;

    ctx.save();

    // 1. Retro radial glow
    const gradient = ctx.createRadialGradient(cx, cy, 20, cx, cy, canvas.width * 0.7);
    gradient.addColorStop(0, 'rgba(255, 0, 127, 0.20)');
    gradient.addColorStop(0.5, 'rgba(121, 40, 202, 0.10)');
    gradient.addColorStop(1, 'rgba(13, 27, 42, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.65);

    // 2. Animated floating goofy pixel balls
    const time = performance.now();
    const float1 = Math.sin(time / 280) * 8;
    const float2 = Math.cos(time / 300) * 8;

    // Left goofy pixel ball (Cyan)
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 192, cy - 25 + float1, 28, 28);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(cx - 190, cy - 23 + float1, 24, 24);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 186, cy - 19 + float1, 4, 8); // eyes
    ctx.fillRect(cx - 176, cy - 19 + float1, 4, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 186, cy - 19 + float1, 2, 4);

    // Right goofy pixel ball (Pink)
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx + 164, cy - 25 + float2, 28, 28);
    ctx.fillStyle = '#ff007f';
    ctx.fillRect(cx + 166, cy - 23 + float2, 24, 24);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx + 172, cy - 19 + float2, 4, 8); // eyes
    ctx.fillRect(cx + 182, cy - 19 + float2, 4, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx + 172, cy - 19 + float2, 2, 4);

    // 3. Top Retro Badge: "100% P2P ARCADE"
    ctx.font = '700 11px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const badgeW = 240;
    const badgeH = 26;
    const badgeY = cy - 60;

    // Neo-brutalist badge shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - badgeW / 2 + 4, badgeY - badgeH / 2 + 4, badgeW, badgeH);
    // Neo-brutalist badge body
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(cx - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(cx - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    // Badge text
    ctx.fillStyle = '#000000';
    ctx.fillText('★ P2P RETRO ARCADE ★', cx, badgeY + 1);

    // 4. Giant 3D Chunky Marquee: "PONGPONG"
    const titleText = 'PONGPONG';
    ctx.font = '900 48px "Press Start 2P", monospace';

    // Layered 3D Extrusion Shadows
    const shadowSteps = 6;
    for (let s = shadowSteps; s >= 1; s--) {
      ctx.fillStyle = s > 3 ? '#000000' : '#ff007f';
      ctx.fillText(titleText, cx + s * 2, cy + s * 2);
    }
    // Main Yellow Face
    ctx.fillStyle = '#ffe600';
    ctx.fillText(titleText, cx, cy);
    // Crisp White Highlight Stroke
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(titleText, cx, cy);

    // 5. Goofy Subtitle Banner
    const subText = '1V1 • 2V2 • 4V4 PADDLE BRAWL';
    ctx.font = '700 10px "Press Start 2P", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(subText, cx + 2, cy + 38);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(subText, cx, cy + 36);

    // 6. Blinking Arcade Prompt
    const blink = Math.floor(time / 550) % 2 === 0;
    if (blink) {
      ctx.font = '700 11px "Press Start 2P", monospace';
      ctx.fillStyle = '#000000';
      ctx.fillText('► SELECT GAME MODE BELOW ◄', cx + 2, cy + 74);
      ctx.fillStyle = '#ffe600';
      ctx.fillText('► SELECT GAME MODE BELOW ◄', cx, cy + 72);
    }

    ctx.restore();
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

    const localUser = this.auth.getUser();
    const opponent = this.getOpponentIdentity();
    const isCoOp = this.isCoOpSameSide();
    const isMultiplayer = Boolean(this.net.remotePlayer) && !isCoOp;
    const posY = panel.posY || 0;
    const cx = canvas.width / 2;

    const centerY =
      screenType === 'gameIntro'
        ? canvas.height * 0.48 - posY / 4
        : canvas.height * 0.43 - posY / 2;

    const leftX = cx - 128;
    const rightX = cx + 128;

    const userWon =
      screenType === 'gameComplete' &&
      window.oGameData &&
      window.oGameData.userScore > window.oGameData.enemyScore;
    const enemyWon =
      screenType === 'gameComplete' &&
      window.oGameData &&
      window.oGameData.enemyScore > window.oGameData.userScore;

    // Center VS / VICTORY Marquee
    if (screenType === 'gameIntro') {
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
    } else {
      // Game Complete Header
      ctx.save();
      const headerY = canvas.height * 0.16 - posY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const bannerText = userWon ? '★ VICTORY! ★' : enemyWon ? '★ DEFEAT! ★' : '★ DRAW! ★';
      ctx.font = '900 28px "Press Start 2P", monospace';

      // 3D shadow
      ctx.fillStyle = '#000000';
      ctx.fillText(bannerText, cx + 4, headerY + 4);
      ctx.fillStyle = userWon ? '#ff007f' : '#334155';
      ctx.fillText(bannerText, cx + 2, headerY + 2);
      ctx.fillStyle = userWon ? '#ffe600' : '#ff477e';
      ctx.fillText(bannerText, cx, headerY);

      // Subtitle
      ctx.font = '700 11px "Press Start 2P", monospace';
      const sub = userWon
        ? 'PONGPONG CHAMPION!'
        : enemyWon
        ? 'REMATCH TO REVENGE!'
        : 'TIED BRAWL!';
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(sub, cx, headerY + 36);

      // Scoreboard Banner Box
      const sbW = 240;
      const sbH = 50;
      const sbY = centerY + 88;

      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - sbW / 2 + 4, sbY - sbH / 2 + 4, sbW, sbH);
      ctx.fillStyle = '#150d2a';
      ctx.fillRect(cx - sbW / 2, sbY - sbH / 2, sbW, sbH);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffe600';
      ctx.strokeRect(cx - sbW / 2, sbY - sbH / 2, sbW, sbH);

      const uScore = window.oGameData?.userScore || 0;
      const eScore = window.oGameData?.enemyScore || 0;

      ctx.font = '900 20px "Press Start 2P", monospace';
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(String(uScore), cx - 50, sbY + 1);
      ctx.fillStyle = '#ffe600';
      ctx.fillText(':', cx, sbY + 1);
      ctx.fillStyle = '#ff007f';
      ctx.fillText(String(eScore), cx + 50, sbY + 1);

      // Bottom Prompt (Positioned in the open gap at 0.70, completely above play button at 0.85)
      const time = performance.now();
      if (Math.floor(time / 500) % 2 === 0) {
        ctx.font = '700 10px "Press Start 2P", monospace';
        const promptY = Math.round(canvas.height * 0.70);
        const promptText = userWon
          ? '► CLICK PLAY OR OPEN LOBBY ◄'
          : '► CLICK REPLAY OR OPEN LOBBY ◄';
        ctx.fillStyle = '#000000';
        ctx.fillText(promptText, cx + 2, promptY + 2);
        ctx.fillStyle = '#ffe600';
        ctx.fillText(promptText, cx, promptY);
      }
      ctx.restore();
    }

    // 1P Card
    this.drawLargeMatchPfpCard(
      ctx,
      leftX,
      centerY,
      localUser,
      userWon ? '#ffe600' : '#00f0ff',
      '1P',
      userWon
    );

    // 2P / BOT Card
    this.drawLargeMatchPfpCard(
      ctx,
      rightX,
      centerY,
      opponent,
      enemyWon ? '#ffe600' : isMultiplayer ? '#ff007f' : '#ff9900',
      isMultiplayer ? '2P' : 'BOT',
      enemyWon
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
}
