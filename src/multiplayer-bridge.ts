import { BOT_PROFILE, type DiscordAuthManager, type PlayerIdentity } from './auth';
import type {
  BallHitPacket,
  BallMissPacket,
  GamePacket,
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
    updateScore: (winner: 'user' | 'enemy') => void;
    initGameComplete: () => void;
    playSound: (id: string) => void;
  }
}

export type ControlMode = 'BOT_MODE' | 'NETWORK_MODE';

export class MultiplayerBridge {
  public mode: ControlMode = 'BOT_MODE';
  private auth: DiscordAuthManager;
  private net: WebRTCRoomManager;
  private seq = 0;
  private lastPointProcessedAt = 0;
  private lastSentNormX = Number.NaN;
  private lastSentNormY = Number.NaN;
  private lastSentPaddleAt = 0;

  constructor(auth: DiscordAuthManager, net: WebRTCRoomManager) {
    this.auth = auth;
    this.net = net;

    this.auth.preloadAvatar(BOT_PROFILE.avatarUrl);

    this.auth.onChange((user) => {
      this.auth.preloadAvatar(user.avatarUrl);
      this.net.setLocalPlayer(user);
    });

    this.net.onRemotePlayerChange((remote) => {
      if (remote?.avatarUrl) {
        this.auth.preloadAvatar(remote.avatarUrl);
      }
    });

    this.net.onPacket((packet) => this.handlePacket(packet));
    this.net.onStatusChange((status) => {
      if (status === 'connected') {
        this.setMode('NETWORK_MODE');
      } else if (status === 'disconnected' || status === 'error') {
        this.setMode('BOT_MODE');
      }
    });
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

  /**
   * Starts a synchronized 1v1 Multiplayer Match on both Host and Guest canvases.
   */
  public startMultiplayerMatch(asInitiator = true) {
    this.setMode('NETWORK_MODE');

    // Ensure tutorial overlay is skipped for 1v1 multiplayer matches
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
        cupId: window.oGameData?.cupId || 0,
        gameId: window.oGameData?.gameId || 0,
      });
    }

    if (typeof window._initGame === 'function') {
      window._initGame();
    } else if (typeof window.initGame === 'function') {
      window.initGame(true);
    }

    // Configure initial serve: Host serves first ('user' on Host, 'enemy' on Guest)
    setTimeout(() => {
      if (window.enemyBat) {
        window.enemyBat.controlMode = 'NETWORK_MODE';
        window.enemyBat.networkTargX = 0;
        window.enemyBat.networkTargY = 0;
      }
      if (window.ball) {
        const initialServer = this.net.role === 'guest' ? 'enemy' : 'user';
        window.ball.serveFlip = this.net.role !== 'guest';
        window.ball.resetServe(initialServer);
      }
    }, 30);
  }

  /**
   * Called every animation frame from `updateGameEvent()` in `js/app.js`.
   * Streams normalized local paddle coordinates over the WebRTC fast UDP channel.
   */
  public onFrameTick() {
    if (this.net.status === 'connected' && this.mode !== 'NETWORK_MODE') {
      this.setMode('NETWORK_MODE');
    }
    if (this.mode !== 'NETWORK_MODE' || this.net.status !== 'connected') return;
    const canvas = window.canvas;
    const userBat = window.userBat;
    if (!canvas || !userBat) return;

    const normX = Math.max(-1.2, Math.min(1.2, (userBat.x - canvas.width / 2) / 250));
    const maxY = userBat.maxY || canvas.height * 0.55;
    const normY = Math.max(0, Math.min(1, (userBat.y - maxY) / 260));

    // Only transmit when the local player actually moves their mouse/paddle (or every 800ms keepalive)
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
   * Called when local `userBat` serves or returns the ball in `js/app.js`.
   */
  public onLocalBallHit(
    ball: any,
    hitData: { x: number; y: number; speed: number; spin: number },
    isServe: boolean
  ) {
    if (this.mode !== 'NETWORK_MODE' || this.net.status !== 'connected') return;

    const packet: BallHitPacket = {
      type: 'BALL_HIT',
      isServe,
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
   * Handles point termination in `NETWORK_MODE` so Host and Guest never desync scores.
   */
  public handleBallOut(ball: any, reason: 'off_table' | 'bottom_out'): boolean {
    if (this.mode !== 'NETWORK_MODE' || this.net.status !== 'connected') {
      return false; // Let default single-player logic handle it
    }

    const now = performance.now();
    if (now - this.lastPointProcessedAt < 650) {
      return true; // Debounce duplicate out triggers during the same rally end
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
      // Pause ball locally until Host's authoritative POINT_RESULT arrives (usually < 10ms)
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
    if (packet.type === 'MATCH_START' || packet.type === 'MATCH_REMATCH') {
      this.startMultiplayerMatch(false);
      return;
    }

    if (packet.type === 'PADDLE_MOVE') {
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

      // Transform normalized table coordinates from remote Player's bottom-side perspective
      // to local `enemyBat` top-side perspective
      ball.offTable = false;
      ball.offSide = false;
      ball.ballShortState = 0;
      ball.bounceNum = 0;
      ball.lastHit = 'enemy';
      ball.tablePosX = -packet.tablePosX;
      ball.tablePosY = packet.isServe ? 0.2 : Math.max(0.05, Math.min(0.48, 1.0 - packet.tablePosY));
      ball.height = Math.max(12, packet.height || 18);
      ball.servingState = packet.isServe ? 0 : 2;

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

      // Evaluate from Guest's perspective: on Guest's screen, 'user' is Guest and 'enemy' is Host
      let winnerRole: 'host' | 'guest';
      if (packet.reason === 'bottom_out') {
        // Ball passed Guest's bottom edge: if it bounced on Guest's side (bounceNum > 0), Host wins point!
        winnerRole = packet.bounceNum > 0 || packet.ballShortState > 0 ? 'host' : 'guest';
      } else {
        if (packet.lastHit === 'user') {
          winnerRole = packet.bounceNum === 0 ? 'host' : 'guest';
        } else {
          winnerRole = packet.bounceNum === 0 ? 'guest' : 'host';
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

      // Set exact synchronized scores (on Guest, userScore = guestScore, enemyScore = hostScore)
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
   * Returns the opponent's PlayerIdentity (Remote Player in 1v1 lobby, or AI Bot in solo mode).
   */
  public getOpponentIdentity(): PlayerIdentity {
    if (this.net.remotePlayer) {
      return this.net.remotePlayer;
    }
    return BOT_PROFILE;
  }

  /**
   * Renders a floating Discord Avatar + Username badge directly above `userBat` during gameplay.
   */
  public renderUserIdentity(ctx: CanvasRenderingContext2D, bat: any) {
    if (window.firstRun) return;
    const user = this.auth.getUser();
    if (!user) return;

    const badgeX = bat.x;
    const badgeY = bat.y - 88 * bat.scale;
    this.drawFloatingPlayerTag(ctx, badgeX, badgeY, user, '#00f2fe', Math.max(0.78, Math.min(1.05, bat.scale)));
  }

  /**
   * Renders a floating Discord Avatar + Username badge directly above `enemyBat` during gameplay.
   */
  public renderEnemyIdentity(ctx: CanvasRenderingContext2D, bat: any) {
    if (window.firstRun) return;
    const tableTop = window.tableTop;
    const isNetwork = bat.controlMode === 'NETWORK_MODE' || this.mode === 'NETWORK_MODE';
    const offsetX =
      !isNetwork && tableTop
        ? (tableTop.offsetX + 0.8 * (bat.flailInc || 0)) * tableTop.sideMultiplier
        : 0;
    const badgeX = bat.x + offsetX;
    const badgeY = bat.y - 54 * (bat.scale || 0.5);

    if (isNetwork && this.net.remotePlayer) {
      this.drawFloatingPlayerTag(ctx, badgeX, badgeY, this.net.remotePlayer, '#ff477e', 0.82);
    } else {
      this.drawBotTag(ctx, badgeX, badgeY);
    }
  }

  /**
   * Directly replaces the top country flags in `case "game"` with User PFP 1 vs User PFP 2.
   */
  public renderTopScoreboardAvatars(ctx: CanvasRenderingContext2D, panel: any) {
    const canvas = window.canvas;
    if (!canvas || !panel) return;

    const localUser = this.auth.getUser();
    const opponent = this.getOpponentIdentity();
    const isMultiplayer = Boolean(this.net.remotePlayer);
    const posY = panel.posY || 0;
    const centerY = 30 - posY;

    // Left slot (User PFP 1 - replaces left country flag next to left score card)
    this.drawTopPfpSlot(
      ctx,
      canvas.width / 2 - 54,
      centerY,
      localUser,
      '#00f2fe',
      'left'
    );

    // Right slot (User PFP 2 - replaces right country flag next to right score card)
    this.drawTopPfpSlot(
      ctx,
      canvas.width / 2 + 54,
      centerY,
      opponent,
      isMultiplayer ? '#ff477e' : '#94a3b8',
      'right'
    );
  }

  /**
   * Directly replaces the large country flags on the `gameIntro` (VS screen)
   * and `gameComplete` (Match Results screen) with User PFP 1 vs User PFP 2 cards.
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
    const isMultiplayer = Boolean(this.net.remotePlayer);
    const posY = panel.posY || 0;

    const centerY =
      screenType === 'gameIntro'
        ? canvas.height * 0.6 - posY / 4
        : canvas.height * 0.55 - 110 - posY / 2;

    const leftX = canvas.width / 2 - 122;
    const rightX = canvas.width / 2 + 122;

    const userWon =
      screenType === 'gameComplete' &&
      window.oGameData &&
      window.oGameData.userScore > window.oGameData.enemyScore;
    const enemyWon =
      screenType === 'gameComplete' &&
      window.oGameData &&
      window.oGameData.enemyScore > window.oGameData.userScore;

    this.drawLargeMatchPfpCard(
      ctx,
      leftX,
      centerY,
      localUser,
      userWon ? '#facc15' : '#00f2fe',
      userWon
    );

    this.drawLargeMatchPfpCard(
      ctx,
      rightX,
      centerY,
      opponent,
      enemyWon ? '#facc15' : isMultiplayer ? '#ff477e' : '#94a3b8',
      enemyWon
    );
  }

  /**
   * Legacy hook called at the end of `Panel.prototype.render`.
   */
  public renderPanelOverlay(_ctx: CanvasRenderingContext2D, _panel: any) {
    // Flag slots are now directly replaced inline via renderTopScoreboardAvatars
    // and renderIntroOrCompleteAvatars.
  }

  private drawFloatingPlayerTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    player: PlayerIdentity,
    ringColor: string,
    scale: number
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    const label = player.displayName || player.username;
    ctx.font = '700 13px Inter, system-ui, -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const avatarSize = 24;
    const padX = 10;
    const pillWidth = avatarSize + 8 + textWidth + padX * 2;
    const pillHeight = 32;

    // Pill background
    ctx.fillStyle = 'rgba(13, 27, 42, 0.84)';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    this.roundRect(ctx, -pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight, 16);
    ctx.fill();
    ctx.stroke();

    // Little pointer triangle pointing to paddle
    ctx.beginPath();
    ctx.moveTo(-5, pillHeight / 2);
    ctx.lineTo(5, pillHeight / 2);
    ctx.lineTo(0, pillHeight / 2 + 5);
    ctx.closePath();
    ctx.fillStyle = ringColor;
    ctx.fill();

    // Circular Avatar
    const avatarCenterX = -pillWidth / 2 + padX + avatarSize / 2;
    const img = this.auth.preloadAvatar(player.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, 0, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, avatarCenterX - avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || '#5865F2';
      ctx.fillRect(avatarCenterX - avatarSize / 2, -avatarSize / 2, avatarSize, avatarSize);
    }
    ctx.restore();

    // Avatar ring
    ctx.beginPath();
    ctx.arc(avatarCenterX, 0, avatarSize / 2, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Username text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, avatarCenterX + avatarSize / 2 + 7, 1);

    ctx.restore();
  }

  private drawBotTag(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    const label = 'AI BOT';
    const w = ctx.measureText(label).width + 16;
    const h = 22;
    ctx.fillStyle = 'rgba(13, 27, 42, 0.72)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.2;
    this.roundRect(ctx, -w / 2, -h / 2, w, h, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
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
    ringColor: string,
    side: 'left' | 'right'
  ) {
    ctx.save();
    const label = player.displayName || player.username;
    ctx.font = '700 12px Inter, system-ui, -apple-system, sans-serif';
    const textW = Math.min(ctx.measureText(label).width, 100);
    const avatarSize = 36;
    const r = avatarSize / 2;
    const pillH = 44;
    const pillW = avatarSize + textW + 22;

    const pillX = side === 'left' ? edgeX - pillW : edgeX;
    const pillY = centerY - pillH / 2;

    // Pill plate background
    ctx.fillStyle = 'rgba(13, 27, 42, 0.88)';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2;
    this.roundRect(ctx, pillX, pillY, pillW, pillH, 12);
    ctx.fill();
    ctx.stroke();

    const avatarCx =
      side === 'left' ? edgeX - 5 - r : edgeX + 5 + r;
    const img = this.auth.preloadAvatar(player.avatarUrl);

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx, centerY, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, avatarCx - r, centerY - r, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || '#5865F2';
      ctx.fillRect(avatarCx - r, centerY - r, avatarSize, avatarSize);
    }
    ctx.restore();

    // Avatar ring
    ctx.beginPath();
    ctx.arc(avatarCx, centerY, r, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Username
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    if (side === 'left') {
      ctx.textAlign = 'right';
      ctx.fillText(label, avatarCx - r - 7, centerY + 1, 100);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(label, avatarCx + r + 7, centerY + 1, 100);
    }

    ctx.restore();
  }

  private drawLargeMatchPfpCard(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    player: PlayerIdentity,
    ringColor: string,
    isWinner = false
  ) {
    ctx.save();
    const avatarSize = 78;
    const r = avatarSize / 2;
    const label = player.displayName || player.username;

    // Outer glow backdrop
    ctx.fillStyle = 'rgba(13, 27, 42, 0.9)';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = isWinner ? 3.5 : 2.5;
    this.roundRect(ctx, centerX - 50, centerY - 52, 100, 114, 18);
    ctx.fill();
    ctx.stroke();

    const avatarCy = centerY - 8;
    const img = this.auth.preloadAvatar(player.avatarUrl);

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, avatarCy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, centerX - r, avatarCy - r, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = player.accentColor || '#5865F2';
      ctx.fillRect(centerX - r, avatarCy - r, avatarSize, avatarSize);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(centerX, avatarCy, r, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Username banner below avatar
    ctx.font = '800 13px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillStyle = isWinner ? '#facc15' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, centerX, centerY + 44, 90);

    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
