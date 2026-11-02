import { BOT_PROFILE, type DiscordAuthManager } from './auth';
import {
  ARENA_MAPS,
  PADDLE_COLORS,
  type MultiplayerBridge,
} from './multiplayer-bridge';
import type { WebRTCRoomManager } from './network';

export class LobbyOverlayUI {
  private root: HTMLElement;
  private auth: DiscordAuthManager;
  private net: WebRTCRoomManager;
  private bridge: MultiplayerBridge;
  private modalOpen = false;
  private inPreGameLobby = false;
  private currentGameState = 'start';
  private statusText = 'READY PLAYER 1 — 1V1 RETRO ARCADE';

  constructor(auth: DiscordAuthManager, net: WebRTCRoomManager, bridge: MultiplayerBridge) {
    this.auth = auth;
    this.net = net;
    this.bridge = bridge;

    let existing = document.getElementById('ttwt-ui-root');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'ttwt-ui-root';
      document.body.appendChild(existing);
    }
    this.root = existing;

    this.bridge.registerGameStateListener((state) => {
      this.currentGameState = state;
      if (state === 'game' || state === 'gameComplete' || state === 'pause') {
        this.inPreGameLobby = false;
        this.modalOpen = false;
      }
      this.render();
    });

    this.bridge.onLobbyStateChange(() => {
      this.render();
    });

    this.auth.onChange((user) => {
      this.net.setLocalPlayer(user);
      this.render();
    });

    this.net.onStatusChange((_status, detail) => {
      if (detail) this.statusText = detail.toUpperCase();
      this.render();
    });

    this.net.onRemotePlayerChange(() => {
      this.render();
    });

    // Update RTT badge periodically when connected
    window.setInterval(() => {
      if (this.net.status === 'connected') {
        const pingEl = document.getElementById('ttwt-live-rtt');
        if (pingEl) {
          pingEl.textContent = `${this.net.rttMs || 1}MS P2P`;
        }
      }
    }, 1000);

    // Pressing ESC closes the profile modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalOpen) {
        this.closeModal();
      }
    });

    this.render();
  }

  public openPreGameLobby() {
    this.inPreGameLobby = true;
    this.modalOpen = false;
    this.render();
  }

  public closePreGameLobby() {
    this.inPreGameLobby = false;
    this.render();
  }

  public openModal() {
    this.modalOpen = true;
    this.render();
  }

  public closeModal() {
    this.modalOpen = false;
    this.render();
  }

  private getShareUrl(roomCode: string, asMockP2 = false): string {
    const base = `${window.location.origin}${window.location.pathname}`;
    return asMockP2 ? `${base}?room=${roomCode}&mock=p2` : `${base}?room=${roomCode}`;
  }

  private renderPaddleIconSvg(hex: string, size = 28): string {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(2px 2px 0px #000);">
        <rect x="15" y="22" width="6" height="12" rx="2" fill="#d97706" stroke="#000" stroke-width="2"/>
        <circle cx="18" cy="14" r="11" fill="${hex}" stroke="#000" stroke-width="2.5"/>
        <path d="M11 10C13 7 17 6 21 7" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  public render() {
    const user = this.auth.getUser();
    const isConnected = this.net.status === 'connected';
    const isWaiting = this.net.status === 'waiting_for_peer' || this.net.status === 'handshaking';
    const remote = this.net.remotePlayer;
    const hasPeerInLobby = Boolean(remote);

    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room')?.toUpperCase().trim() || '';
    const activeRoomCode = this.net.roomCode || urlRoom;

    const showModeDock =
      this.currentGameState === 'start' && !this.inPreGameLobby && !this.modalOpen;
    const showPreGame = this.currentGameState === 'start' && this.inPreGameLobby;
    const showForfeit = this.currentGameState === 'game';

    const canSelectMap = this.bridge.canLocalSelectMap();
    const selectedMap = this.bridge.getSelectedMap();
    const localColorObj =
      PADDLE_COLORS.find((c) => c.hex === this.bridge.localPaddleColor) || PADDLE_COLORS[0];
    const botFallbackHex =
      this.bridge.localPaddleColor === '#00f0ff' ? '#ff007f' : '#00f0ff';
    const opponentPaddleHex = hasPeerInLobby ? this.bridge.remotePaddleColor : botFallbackHex;
    const opponentColorObj =
      PADDLE_COLORS.find((c) => c.hex === opponentPaddleHex) || PADDLE_COLORS[1];

    this.root.innerHTML = `
      <!-- 🕹️ Top-Left Retro Arcade HUD (Compact & Non-Obstructive) -->
      <div class="ttwt-hud-bar" id="ttwt-hud-bar">
        <button class="ttwt-hud-compact-btn" id="ttwt-open-lobby-btn" title="Player Profile & Discord Login">
          <span class="ttwt-hud-player-chip">${this.net.role === 'guest' ? '2P' : '1P'}</span>
          <img class="ttwt-hud-mini-avatar" src="${user.avatarUrl}" alt="${user.displayName}" />
          <span class="ttwt-hud-compact-title">${this.escapeHtml(user.displayName).slice(0, 8)}</span>
          <span class="ttwt-hud-status-badge ${isConnected ? 'p2p' : isWaiting ? 'waiting' : 'bot'}">
            <span class="ttwt-dot ${isConnected ? '' : 'ttwt-dot-pulse'}"></span>
            <span class="ttwt-status-text" id="ttwt-live-rtt">${
              isConnected
                ? `${this.net.rttMs || 1}MS P2P`
                : this.net.roomCode
                ? `RM:${this.net.roomCode}`
                : 'SOLO'
            }</span>
          </span>
        </button>

        ${
          this.net.roomCode
            ? `
          <button class="ttwt-hud-invite-btn" id="ttwt-hud-invite-btn" title="Click to copy invite link">
            <span class="ttwt-invite-icon">🔗</span>
            <span class="ttwt-invite-label">INVITE</span>
            <span class="ttwt-invite-code">${this.net.roomCode}</span>
          </button>
        `
            : ''
        }
      </div>

      <!-- 🏳️ Top-Right Forfeit / Exit Button (ONLY Visible During Active Gameplay) -->
      <div class="ttwt-top-right-bar ${showForfeit ? '' : 'ttwt-hidden'}" id="ttwt-top-right-bar">
        <button class="ttwt-forfeit-btn" id="ttwt-forfeit-btn" title="Forfeit match and exit to menu">
          <span class="ttwt-forfeit-icon">🏳️</span>
          <span class="ttwt-forfeit-text">FORFEIT</span>
        </button>
      </div>

      <!-- 🎮 First Page Retro Mode Dock (Positioned directly under "SELECT GAME MODE BELOW") -->
      <div class="ttwt-mode-dock ${showModeDock ? '' : 'ttwt-hidden'}" id="ttwt-mode-dock">
        <div class="ttwt-mode-dock-bar">
          <div class="ttwt-mode-dock-badge">★ SELECT ARCADE MODE ★</div>

          <div class="ttwt-mode-cards-grid">
            <!-- 🏓 1V1 MODE (PRIMARY) -->
            <button class="ttwt-mode-card ttwt-mode-card-1v1" id="ttwt-launch-1v1-btn">
              <div class="ttwt-card-tag">AUTO-ROOM</div>
              <div class="ttwt-card-icon">🏓</div>
              <div class="ttwt-card-title">1V1 BRAWL</div>
              <div class="ttwt-card-desc">${
                activeRoomCode ? `OPEN LOBBY ${activeRoomCode}` : 'PRE-GAME LOBBY • BOT OR 1V1'
              }</div>
              <div class="ttwt-card-action">► ENTER LOBBY ◄</div>
            </button>

            <!-- 👥 2V2 MODE (SOON) -->
            <button class="ttwt-mode-card ttwt-mode-card-locked" id="ttwt-launch-2v2-btn" title="Coming soon!">
              <div class="ttwt-card-tag soon">SOON</div>
              <div class="ttwt-card-icon">👥</div>
              <div class="ttwt-card-title">2V2 DOUBLES</div>
              <div class="ttwt-card-desc">CO-OP TEAMS & SIDE PICK</div>
              <div class="ttwt-card-action locked">LOCKED</div>
            </button>

            <!-- 💥 4V4 MODE (SOON) -->
            <button class="ttwt-mode-card ttwt-mode-card-locked" id="ttwt-launch-4v4-btn" title="Coming soon!">
              <div class="ttwt-card-tag soon">SOON</div>
              <div class="ttwt-card-icon">💥</div>
              <div class="ttwt-card-title">4V4 CHAOS</div>
              <div class="ttwt-card-desc">8-PADDLE ARCADE MAYHEM</div>
              <div class="ttwt-card-action locked">LOCKED</div>
            </button>
          </div>

          <!-- Quick Join With Room Code Row -->
          <div class="ttwt-quick-join-dock">
            <span class="ttwt-quick-join-label">HAVE A ROOM CODE?</span>
            <input
              type="text"
              class="ttwt-quick-join-field"
              id="ttwt-dock-join-code-input"
              placeholder="6-CHAR CODE"
              maxlength="6"
              value="${activeRoomCode}"
            />
            <button class="ttwt-btn ttwt-btn-cyan ttwt-dock-join-btn" id="ttwt-dock-join-btn">
              JOIN LOBBY
            </button>
          </div>
        </div>
      </div>

      <!-- 🏟️ PRE-GAME LOBBY SCREEN (Map Selection + Paddle Color Picker + Waiting Room) -->
      <div class="ttwt-pregame-backdrop ${showPreGame ? '' : 'ttwt-hidden'}" id="ttwt-pregame-screen">
        <div class="ttwt-pregame-cabinet">
          <!-- Header Row -->
          <div class="ttwt-pregame-header">
            <button class="ttwt-btn ttwt-btn-ghost ttwt-pregame-back-btn" id="ttwt-pregame-back-btn">
              ⬅ MODES
            </button>

            <div class="ttwt-pregame-title-wrap">
              <div class="ttwt-pregame-main-title">★ 1V1 PRE-GAME LOBBY ★</div>
              <div class="ttwt-pregame-sub-title">
                ${
                  hasPeerInLobby
                    ? 'PLAYER 2 IN LOBBY! READY TO BRAWL!'
                    : 'WAITING FOR PLAYER 2 • OR START NOW VS AI BOT'
                }
              </div>
            </div>

            <div class="ttwt-pregame-room-bar">
              <div class="ttwt-pregame-code-pill">
                <span class="ttwt-code-label">ROOM</span>
                <span class="ttwt-code-val">${this.net.roomCode || '------'}</span>
              </div>
              <button class="ttwt-btn ttwt-btn-cyan ttwt-pregame-copy-btn" id="ttwt-pregame-copy-btn" title="Copy invite link for friend">
                🔗 INVITE
              </button>
              ${
                this.net.role === 'host' && !hasPeerInLobby && this.net.roomCode
                  ? `
                <button class="ttwt-btn ttwt-btn-pink ttwt-pregame-copy-btn" id="ttwt-pregame-spawn-btn" title="Open 2nd window as Player 2 for testing">
                  🚀 TEST 2P
                </button>
              `
                  : ''
              }
            </div>
          </div>

          <!-- Players VS Row -->
          <div class="ttwt-pregame-players-row">
            <!-- Local Player (You) -->
            <div class="ttwt-pregame-player-card local">
              <div class="ttwt-player-role-tag ${this.net.role === 'guest' ? 'guest' : 'host'}">
                ${this.net.role === 'guest' ? '2P • GUEST (YOU)' : '1P • HOST (YOU)'}
              </div>
              <div class="ttwt-player-card-main">
                <img class="ttwt-player-card-avatar" src="${user.avatarUrl}" alt="${user.displayName}" />
                <div class="ttwt-player-card-meta">
                  <div class="ttwt-player-card-name">${this.escapeHtml(user.displayName)}</div>
                  <div class="ttwt-player-card-status">READY TO SERVE</div>
                </div>
                <div class="ttwt-player-paddle-badge" title="Your Paddle: ${localColorObj.name}">
                  ${this.renderPaddleIconSvg(this.bridge.localPaddleColor, 34)}
                  <span>${localColorObj.name}</span>
                </div>
              </div>
            </div>

            <div class="ttwt-pregame-vs-pill">VS</div>

            <!-- Opponent (Player 2 or AI Bot Fallback) -->
            <div class="ttwt-pregame-player-card opponent ${hasPeerInLobby ? 'human' : 'bot'}">
              <div class="ttwt-player-role-tag ${hasPeerInLobby ? 'guest' : 'bot'}">
                ${
                  hasPeerInLobby
                    ? this.net.role === 'guest'
                      ? '1P • HOST'
                      : '2P • CHALLENGER'
                    : '🤖 AI BOT (IF SOLO)'
                }
              </div>
              <div class="ttwt-player-card-main">
                <img
                  class="ttwt-player-card-avatar"
                  src="${hasPeerInLobby && remote ? remote.avatarUrl : BOT_PROFILE.avatarUrl}"
                  alt="Opponent"
                />
                <div class="ttwt-player-card-meta">
                  <div class="ttwt-player-card-name">
                    ${hasPeerInLobby && remote ? this.escapeHtml(remote.displayName) : 'AI BOT'}
                  </div>
                  <div class="ttwt-player-card-status ${hasPeerInLobby ? 'online' : 'waiting'}">
                    ${
                      hasPeerInLobby
                        ? isConnected
                          ? '⚡ P2P LINKED'
                          : '⏳ HANDSHAKING...'
                        : 'WAITING FOR P2 JOIN...'
                    }
                  </div>
                </div>
                <div class="ttwt-player-paddle-badge" title="Opponent Paddle: ${opponentColorObj.name}">
                  ${this.renderPaddleIconSvg(opponentPaddleHex, 34)}
                  <span>${opponentColorObj.name}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 🏟️ Map Selector (Visible to all, only Host can change) -->
          <div class="ttwt-pregame-section">
            <div class="ttwt-pregame-section-head">
              <span>🏟️ ARENA MAP: <b style="color: #fff;">${selectedMap.name}</b></span>
              <span class="ttwt-map-perm-badge ${canSelectMap ? 'host' : 'guest'}">
                ${
                  canSelectMap
                    ? '👑 HOST CONTROLS MAP'
                    : '🔒 HOST IS SELECTING MAP (LIVE)'
                }
              </span>
            </div>

            <div class="ttwt-map-cards-row">
              ${ARENA_MAPS.map((m) => {
                const isSelected = m.id === selectedMap.id;
                return `
                  <button
                    class="ttwt-map-option-card ${isSelected ? 'selected' : ''} ${
                  canSelectMap ? '' : 'readonly'
                }"
                    data-map-id="${m.id}"
                    title="${
                      canSelectMap
                        ? `Select ${m.name}`
                        : `Only the Host can change the map (${m.name})`
                    }"
                  >
                    <div class="ttwt-map-mini-preview" style="background: ${m.previewWallHex};">
                      <div class="ttwt-map-mini-table" style="background: ${m.previewTableHex};">
                        <div class="ttwt-map-mini-net"></div>
                        <div class="ttwt-map-mini-line"></div>
                      </div>
                      ${isSelected ? `<div class="ttwt-map-selected-star">★</div>` : ''}
                    </div>
                    <div class="ttwt-map-option-name">${m.name}</div>
                    <div class="ttwt-map-option-sub">${m.subtitle}</div>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- 🎨 Paddle Color Selector (All users can customize their paddle) -->
          <div class="ttwt-pregame-section">
            <div class="ttwt-pregame-section-head">
              <span>🎨 YOUR PADDLE COLOR (ALL PLAYERS)</span>
              <span style="color: ${this.bridge.localPaddleColor}; font-weight: 900;">
                ● ${localColorObj.name}
              </span>
            </div>

            <div class="ttwt-paddle-colors-row">
              ${PADDLE_COLORS.map((c) => {
                const active = c.hex === this.bridge.localPaddleColor;
                return `
                  <button
                    class="ttwt-color-swatch-btn ${active ? 'active' : ''}"
                    data-paddle-hex="${c.hex}"
                    title="${c.name}"
                  >
                    ${this.renderPaddleIconSvg(c.hex, 26)}
                    <span class="ttwt-swatch-name">${c.name.split(' ')[1] || c.name}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- 🚀 Start Match Footer -->
          <div class="ttwt-pregame-footer">
            <button class="ttwt-btn ttwt-btn-arcade ttwt-pregame-start-btn" id="ttwt-pregame-start-btn">
              ${
                hasPeerInLobby
                  ? `🏓 START 1V1 MATCH VS ${this.escapeHtml(remote!.displayName.toUpperCase())}!`
                  : '🏓 START GAME (VS AI BOT)'
              }
            </button>
          </div>
        </div>
      </div>

      <!-- 👾 Retro Profile & Discord Modal (Accessible from Top-Left 1P Button) -->
      <div class="ttwt-modal-backdrop ${this.modalOpen ? '' : 'ttwt-hidden'}" id="ttwt-modal-backdrop">
        <div class="ttwt-modal-card" id="ttwt-modal-card">
          <div class="ttwt-modal-header">
            <div class="ttwt-modal-title">
              <span class="ttwt-logo-main">PONGPONG</span>
              <span class="ttwt-logo-sub">PLAYER PROFILE</span>
            </div>
            <button class="ttwt-close-btn" id="ttwt-close-modal-btn" title="Close">✕</button>
          </div>

          <div class="ttwt-section">
            <div class="ttwt-section-label">
              <span>PLAYER IDENTITY</span>
              <span style="color: var(--pp-text-muted);">APP: ${this.auth.getDiscordClientId().slice(0, 6)}...</span>
            </div>

            <div class="ttwt-profile-row">
              <div class="ttwt-profile-info">
                <img class="ttwt-profile-avatar-lg" src="${user.avatarUrl}" alt="${user.displayName}" />
                <div>
                  <div style="font-size: 18px; font-weight: 900; color: #fff;">
                    ${this.escapeHtml(user.displayName)}
                  </div>
                  <div style="font-size: 13px; font-weight: 700; color: var(--pp-cyan);">
                    @${this.escapeHtml(user.username)} • ${
      user.authProvider === 'discord' ? 'DISCORD OAUTH' : 'DEV MOCK'
    }
                  </div>
                </div>
              </div>

              <button class="ttwt-btn ttwt-btn-discord" id="ttwt-discord-oauth-btn">
                LOGIN DISCORD
              </button>
            </div>

            <div class="ttwt-mock-toggles">
              <button class="ttwt-mock-chip ${user.username === 'sour' ? 'active' : ''}" data-mock="sour">
                👑 MOCK: SOUR (P1)
              </button>
              <button class="ttwt-mock-chip ${user.username === 'player_two' ? 'active' : ''}" data-mock="player2">
                🔥 MOCK: PLAYER 2 (P2)
              </button>
              <button class="ttwt-mock-chip ${user.username === 'kanto_ace' ? 'active' : ''}" data-mock="ace">
                ⚡ MOCK: KANTO_ACE
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    document.getElementById('ttwt-open-lobby-btn')?.addEventListener('click', () => this.openModal());
    document.getElementById('ttwt-close-modal-btn')?.addEventListener('click', () => this.closeModal());

    document.getElementById('ttwt-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.id === 'ttwt-modal-backdrop') {
        this.closeModal();
      }
    });

    document.querySelectorAll('.ttwt-mock-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = (btn as HTMLElement).getAttribute('data-mock') as 'sour' | 'player2' | 'ace';
        if (preset) {
          this.auth.loginWithMock(preset);
        }
      });
    });

    document.getElementById('ttwt-discord-oauth-btn')?.addEventListener('click', () => {
      const res = this.auth.startDiscordOAuth();
      if (!res.ok && res.error) {
        this.statusText = res.error.toUpperCase();
        this.render();
      }
    });

    // 🏓 1v1 Mode Card on Start Screen -> Opens Pre-Game Lobby & Auto-Creates Room
    document.getElementById('ttwt-launch-1v1-btn')?.addEventListener('click', async () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit0');
      }

      this.openPreGameLobby();

      const urlParams = new URLSearchParams(window.location.search);
      const urlRoom = urlParams.get('room')?.toUpperCase().trim();

      if (urlRoom && !this.net.roomCode) {
        await this.net.joinRoom(urlRoom);
      } else if (!this.net.roomCode) {
        const code = await this.net.createRoom();
        window.history.replaceState(null, '', `?room=${code}`);
        this.render();
      }
    });

    // 👥 2V2 & 💥 4V4 Coming Soon Buttons
    const showSoonNotice = (modeName: string) => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit3');
      }
      this.showToast(`👥 ${modeName} COMING SOON!\nPLAY 1V1 BRAWL FOR NOW!`);
    };

    document.getElementById('ttwt-launch-2v2-btn')?.addEventListener('click', () => {
      showSoonNotice('2V2 DOUBLES');
    });

    document.getElementById('ttwt-launch-4v4-btn')?.addEventListener('click', () => {
      showSoonNotice('4V4 CHAOS');
    });

    // Quick Join with Code on Start Screen -> Joins Room & Opens Pre-Game Lobby
    const dockJoinInput = document.getElementById('ttwt-dock-join-code-input') as HTMLInputElement | null;
    const handleDockJoin = async () => {
      const code = dockJoinInput?.value.trim().toUpperCase() || '';
      if (code.length < 4) {
        this.showToast('ENTER VALID 6-CHAR CODE!');
        return;
      }
      if (typeof window.playSound === 'function') {
        window.playSound('hit0');
      }
      this.openPreGameLobby();
      window.history.replaceState(null, '', `?room=${code}`);
      await this.net.joinRoom(code);
    };

    document.getElementById('ttwt-dock-join-btn')?.addEventListener('click', handleDockJoin);
    dockJoinInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleDockJoin();
    });

    // ⬅ Back Button in Pre-Game Lobby
    document.getElementById('ttwt-pregame-back-btn')?.addEventListener('click', () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit1');
      }
      this.closePreGameLobby();
    });

    // 🔗 Copy Invite Link in Pre-Game Lobby or HUD
    const copyRoomInvite = () => {
      if (!this.net.roomCode) return;
      const inviteUrl = this.getShareUrl(this.net.roomCode, false);
      navigator.clipboard
        .writeText(inviteUrl)
        .then(() => {
          this.showToast(`✓ INVITE LINK COPIED!\nROOM CODE: ${this.net.roomCode}`);
        })
        .catch(() => {
          this.showToast(`ROOM CODE: ${this.net.roomCode}`);
        });
    };

    document.getElementById('ttwt-hud-invite-btn')?.addEventListener('click', copyRoomInvite);
    document.getElementById('ttwt-pregame-copy-btn')?.addEventListener('click', copyRoomInvite);

    // 🚀 Spawn 2P Test Window in Pre-Game Lobby
    document.getElementById('ttwt-pregame-spawn-btn')?.addEventListener('click', () => {
      if (!this.net.roomCode) return;
      const url = this.getShareUrl(this.net.roomCode, true);
      window.open(url, '_blank');
    });

    // 🏟️ Map Selection Cards (Host only)
    document.querySelectorAll('.ttwt-map-option-card').forEach((card) => {
      card.addEventListener('click', () => {
        const mapId = (card as HTMLElement).getAttribute('data-map-id');
        if (!mapId) return;
        if (!this.bridge.canLocalSelectMap()) {
          this.showToast('🔒 ONLY THE HOST CAN SELECT THE MAP!');
          return;
        }
        if (typeof window.playSound === 'function') {
          window.playSound('hit2');
        }
        this.bridge.setSelectedMap(mapId);
      });
    });

    // 🎨 Paddle Color Swatches (All Players)
    document.querySelectorAll('.ttwt-color-swatch-btn').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        const hex = (swatch as HTMLElement).getAttribute('data-paddle-hex');
        if (!hex) return;
        if (typeof window.playSound === 'function') {
          window.playSound('hit4');
        }
        this.bridge.setLocalPaddleColor(hex);
      });
    });

    // 🏓 Start Game Button in Pre-Game Lobby
    document.getElementById('ttwt-pregame-start-btn')?.addEventListener('click', () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit0');
      }
      this.inPreGameLobby = false;
      this.bridge.start1v1Match();
    });

    // 🏳️ Forfeit / Exit Button (during active game)
    document.getElementById('ttwt-forfeit-btn')?.addEventListener('click', () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit2');
      }
      this.bridge.forfeitOrExitMatch();
    });
  }

  public showToast(msg: string) {
    const existing = document.getElementById('ttwt-retro-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ttwt-retro-toast';
    toast.className = 'ttwt-retro-toast';
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, 2200);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
