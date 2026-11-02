import type { DiscordAuthManager } from './auth';
import type { MultiplayerBridge } from './multiplayer-bridge';
import type { WebRTCRoomManager } from './network';

export class LobbyOverlayUI {
  private root: HTMLElement;
  private auth: DiscordAuthManager;
  private net: WebRTCRoomManager;
  private bridge: MultiplayerBridge;
  private modalOpen = false;
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

  public render() {
    const user = this.auth.getUser();
    const isConnected = this.net.status === 'connected';
    const isWaiting = this.net.status === 'waiting_for_peer' || this.net.status === 'handshaking';
    const remote = this.net.remotePlayer;

    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room')?.toUpperCase().trim() || '';
    const activeRoomCode = this.net.roomCode || urlRoom;

    this.root.innerHTML = `
      <!-- 🕹️ Top-Left Retro Arcade HUD (Compact & Non-Obstructive) -->
      <div class="ttwt-hud-bar" id="ttwt-hud-bar">
        <button class="ttwt-hud-compact-btn" id="ttwt-open-lobby-btn" title="Player Settings & Discord Login (Esc)">
          <span class="ttwt-hud-player-chip">1P</span>
          <img class="ttwt-hud-mini-avatar" src="${user.avatarUrl}" alt="${user.displayName}" />
          <span class="ttwt-hud-compact-title">${this.escapeHtml(user.displayName).slice(0, 8)}</span>
          <span class="ttwt-hud-status-badge ${isConnected ? 'p2p' : isWaiting ? 'waiting' : 'bot'}">
            <span class="ttwt-dot ${isConnected ? '' : 'ttwt-dot-pulse'}"></span>
            <span class="ttwt-status-text">${
              isConnected
                ? `${this.net.rttMs || 1}MS`
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

      <!-- 🏳️ Top-Right Forfeit / Exit Button (Visible during gameplay) -->
      <div class="ttwt-top-right-bar ${this.currentGameState === 'game' ? '' : 'ttwt-hidden'}" id="ttwt-top-right-bar">
        <button class="ttwt-forfeit-btn" id="ttwt-forfeit-btn" title="Forfeit match and exit to menu">
          <span class="ttwt-forfeit-icon">🏳️</span>
          <span class="ttwt-forfeit-text">FORFEIT</span>
        </button>
      </div>

      <!-- 🎮 First Page Retro Mode Dock (Visible on Start Screen) -->
      <div class="ttwt-mode-dock ${this.currentGameState === 'start' ? '' : 'ttwt-hidden'}" id="ttwt-mode-dock">
        <div class="ttwt-mode-dock-bar">
          <div class="ttwt-mode-dock-badge">★ SELECT ARCADE MODE ★</div>

          <div class="ttwt-mode-cards-grid">
            <!-- 🏓 1V1 MODE (PRIMARY) -->
            <button class="ttwt-mode-card ttwt-mode-card-1v1" id="ttwt-launch-1v1-btn">
              <div class="ttwt-card-tag">AUTO-ROOM</div>
              <div class="ttwt-card-icon">🏓</div>
              <div class="ttwt-card-title">1V1 BRAWL</div>
              <div class="ttwt-card-desc">${activeRoomCode ? `JOIN ROOM ${activeRoomCode}` : 'PLAY VS BOT • DROP-IN 1V1'}</div>
              <div class="ttwt-card-action">► INSERT COIN ◄</div>
            </button>

            <!-- 👥 2V2 MODE (SOON) -->
            <button class="ttwt-mode-card ttwt-mode-card-locked" id="ttwt-launch-2v2-btn" title="Coming soon!">
              <div class="ttwt-card-tag soon">SOON</div>
              <div class="ttwt-card-icon">👥</div>
              <div class="ttwt-card-title">2V2 DOUBLES</div>
              <div class="ttwt-card-desc">CO-OP TEAMS & SPLIT TABLE</div>
              <div class="ttwt-card-action locked">LOCKED</div>
            </button>

            <!-- 💥 4V4 MODE (SOON) -->
            <button class="ttwt-mode-card ttwt-mode-card-locked" id="ttwt-launch-4v4-btn" title="Coming soon!">
              <div class="ttwt-card-tag soon">SOON</div>
              <div class="ttwt-card-icon">💥</div>
              <div class="ttwt-card-title">4V4 CHAOS</div>
              <div class="ttwt-card-desc">MULTI-BALL MAYHEM</div>
              <div class="ttwt-card-action locked">LOCKED</div>
            </button>
          </div>

          <!-- Quick Join With Room Code Row -->
          <div class="ttwt-quick-join-dock">
            <span class="ttwt-quick-join-label">HAVE A CODE?</span>
            <input
              type="text"
              class="ttwt-quick-join-field"
              id="ttwt-dock-join-code-input"
              placeholder="6-CHAR CODE"
              maxlength="6"
              value="${activeRoomCode}"
            />
            <button class="ttwt-btn ttwt-btn-cyan ttwt-dock-join-btn" id="ttwt-dock-join-btn">
              JOIN MATCH
            </button>
          </div>
        </div>
      </div>

      <!-- 👾 Retro Arcade Cabinet Lobby Modal -->
      <div class="ttwt-modal-backdrop ${this.modalOpen ? '' : 'ttwt-hidden'}" id="ttwt-modal-backdrop">
        <div class="ttwt-modal-card" id="ttwt-modal-card">
          <div class="ttwt-modal-header">
            <div class="ttwt-modal-title">
              <span class="ttwt-logo-main">PONGPONG</span>
              <span class="ttwt-logo-sub">1V1 ARCADE BRAWL</span>
            </div>
            <button class="ttwt-close-btn" id="ttwt-close-modal-btn" title="Close">✕</button>
          </div>

          <!-- Step 1: Retro Player Identity -->
          <div class="ttwt-section">
            <div class="ttwt-section-label">
              <span>PLAYER 1 PROFILE</span>
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
                <svg width="15" height="11" viewBox="0 0 71 55" fill="currentColor">
                  <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.8 58.8 0 0018 9.1.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.6 58.6 0 0070.4 45.6v-.1c1.4-15-2.3-28.4-10.2-40.5a.2.2 0 00-.1-.1zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1zm23.7 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1z"/>
                </svg>
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

          <!-- Step 2: Retro 1v1 Room Machine -->
          <div class="ttwt-section">
            <div class="ttwt-section-label">
              <span>1V1 ARCADE LINK</span>
              <span style="color: ${isConnected ? '#00ff66' : '#00f0ff'};">
                ${this.net.status.toUpperCase().replace(/_/g, ' ')}
              </span>
            </div>

            ${
              this.net.roomCode
                ? `
              <div class="ttwt-room-code-banner">
                <div>
                  <div style="font-family: 'Press Start 2P', monospace; font-size: 8px; color: var(--pp-cyan);">
                    6-CHAR ROOM CODE
                  </div>
                  <div class="ttwt-room-code-text">${this.net.roomCode}</div>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button class="ttwt-btn ttwt-btn-cyan" id="ttwt-copy-link-btn">
                    🔗 COPY INVITE
                  </button>
                  ${
                    this.net.role === 'host' && !isConnected
                      ? `
                    <button class="ttwt-btn ttwt-btn-pink" id="ttwt-spawn-p2-tab-btn" title="Opens a separate window logged in as Player 2 and auto-connects via WebRTC!">
                      🚀 SPAWN 2P WINDOW
                    </button>
                  `
                      : ''
                  }
                  <button class="ttwt-btn ttwt-btn-ghost" id="ttwt-leave-room-btn">
                    LEAVE
                  </button>
                </div>
                <div style="margin-top: 10px; padding: 8px 12px; background: rgba(0, 0, 0, 0.45); border: 2px solid var(--pp-yellow); box-shadow: 3px 3px 0px #000; font-size: 11px; font-weight: 700; color: #ffe600; line-height: 1.4;">
                  💡 <b>SOLO TESTING TIP:</b> Click <b>🚀 SPAWN 2P WINDOW</b> to open side-by-side windows! (Browsers sleep inactive tabs in the same window).
                </div>
              </div>
            `
                : `
              <div class="ttwt-lobby-grid">
                <div class="ttwt-lobby-box">
                  <div style="font-size: 15px; font-weight: 900; color: var(--pp-yellow);">
                    HOST PRIVATE MATCH
                  </div>
                  <div style="font-size: 12px; font-weight: 700; color: var(--pp-text-muted);">
                    Get a 6-character arcade code and challenge a friend.
                  </div>
                  <button class="ttwt-btn ttwt-btn-cyan" id="ttwt-create-room-btn" style="margin-top: auto;">
                    ✨ CREATE ROOM
                  </button>
                </div>

                <div class="ttwt-lobby-box">
                  <div style="font-size: 15px; font-weight: 900; color: var(--pp-pink);">
                    JOIN WITH CODE
                  </div>
                  <input
                    type="text"
                    maxlength="6"
                    placeholder="E.G. 849K2X"
                    class="ttwt-input"
                    id="ttwt-join-code-input"
                  />
                  <button class="ttwt-btn ttwt-btn-emerald" id="ttwt-join-room-btn">
                    ⚡ JOIN MATCH
                  </button>
                </div>
              </div>
            `
            }

            ${
              isConnected && remote
                ? `
              <div class="ttwt-vs-banner">
                <div class="ttwt-vs-player">
                  <img src="${user.avatarUrl}" alt="${user.displayName}" style="border: 3px solid #00f0ff;" />
                  <div>
                    <div style="font-size: 15px; font-weight: 900;">${this.escapeHtml(user.displayName)}</div>
                    <div style="font-family: 'Press Start 2P', monospace; font-size: 8px; color: #00f0ff;">1P (${this.net.role?.toUpperCase()})</div>
                  </div>
                </div>

                <div class="ttwt-vs-middle">
                  VS
                </div>

                <div class="ttwt-vs-player">
                  <div style="text-align: right;">
                    <div style="font-size: 15px; font-weight: 900;">${this.escapeHtml(remote.displayName)}</div>
                    <div style="font-family: 'Press Start 2P', monospace; font-size: 8px; color: #ff007f;">2P OPPONENT</div>
                  </div>
                  <img src="${remote.avatarUrl}" alt="${remote.displayName}" style="border: 3px solid #ff007f;" />
                </div>
              </div>

              <button class="ttwt-btn ttwt-btn-arcade" id="ttwt-start-p2p-match-btn" style="width: 100%; padding: 14px; font-size: 12px;">
                🏓 INSERT COIN — START 1V1 MATCH!
              </button>
            `
                : ''
            }

            <div class="ttwt-status-line">
              <span>${this.escapeHtml(this.statusText)}</span>
              ${
                this.bridge.mode === 'NETWORK_MODE'
                  ? `<button class="ttwt-btn ttwt-btn-ghost" id="ttwt-switch-bot-btn" style="padding: 4px 10px; font-size: 11px;">SWITCH TO BOT</button>`
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    document.getElementById('ttwt-open-lobby-btn')?.addEventListener('click', () => this.openModal());
    document.getElementById('ttwt-hud-profile-trigger')?.addEventListener('click', () => this.openModal());
    document.getElementById('ttwt-close-modal-btn')?.addEventListener('click', () => this.closeModal());

    document.getElementById('ttwt-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.id === 'ttwt-modal-backdrop') {
        this.closeModal();
      }
    });

    // Pressing ESC closes the lobby modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalOpen) {
        this.closeModal();
      }
    });

    document.getElementById('ttwt-quick-mock-toggle')?.addEventListener('click', () => {
      const current = this.auth.getUser();
      if (current.username === 'sour') {
        this.auth.loginWithMock('player2');
      } else {
        this.auth.loginWithMock('sour');
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

    document.getElementById('ttwt-create-room-btn')?.addEventListener('click', async () => {
      await this.net.createRoom();
    });

    const joinInput = document.getElementById('ttwt-join-code-input') as HTMLInputElement | null;
    document.getElementById('ttwt-join-room-btn')?.addEventListener('click', async () => {
      const code = joinInput?.value.trim().toUpperCase() || '';
      if (code.length < 4) {
        this.statusText = 'ENTER VALID 6-CHAR CODE';
        this.render();
        return;
      }
      await this.net.joinRoom(code);
    });

    joinInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const code = joinInput.value.trim().toUpperCase();
        if (code.length >= 4) {
          await this.net.joinRoom(code);
        }
      }
    });

    document.getElementById('ttwt-copy-link-btn')?.addEventListener('click', async () => {
      const url = this.getShareUrl(this.net.roomCode, false);
      try {
        await navigator.clipboard.writeText(url);
        this.statusText = `COPIED INVITE LINK: ${url}`;
      } catch {
        this.statusText = `INVITE LINK: ${url}`;
      }
      this.render();
    });

    document.getElementById('ttwt-spawn-p2-tab-btn')?.addEventListener('click', () => {
      const url = this.getShareUrl(this.net.roomCode, true);
      window.open(url, '_blank');
    });

    document.getElementById('ttwt-leave-room-btn')?.addEventListener('click', () => {
      this.net.disconnect();
      this.bridge.setMode('BOT_MODE');
      this.statusText = 'DISCONNECTED. RETURNED TO BOT MODE.';
      this.render();
    });

    document.getElementById('ttwt-start-p2p-match-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.bridge.startMultiplayerMatch(true);
    });

    document.getElementById('ttwt-switch-bot-btn')?.addEventListener('click', () => {
      this.bridge.setMode('BOT_MODE');
      this.statusText = 'SWITCHED TO BOT MODE.';
      this.render();
    });

    // 🏓 1v1 Launch Button on First Page
    document.getElementById('ttwt-launch-1v1-btn')?.addEventListener('click', async () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit0');
      }

      const urlParams = new URLSearchParams(window.location.search);
      const urlRoom = urlParams.get('room')?.toUpperCase().trim();

      if (urlRoom && (!this.net.roomCode || this.net.role === 'guest')) {
        await this.net.joinRoom(urlRoom);
      } else if (!this.net.roomCode) {
        // Auto-create room for seamless drop-in
        const code = await this.net.createRoom();
        window.history.replaceState(null, '', `?room=${code}`);
      }

      this.bridge.start1v1Match();
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

    // 🏳️ Forfeit / Exit Button (during game)
    document.getElementById('ttwt-forfeit-btn')?.addEventListener('click', () => {
      if (typeof window.playSound === 'function') {
        window.playSound('hit2');
      }
      this.bridge.forfeitOrExitMatch();
    });

    // 🔗 Copy Invite Link in HUD
    document.getElementById('ttwt-hud-invite-btn')?.addEventListener('click', () => {
      if (!this.net.roomCode) return;
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${this.net.roomCode}`;
      navigator.clipboard.writeText(inviteUrl).then(() => {
        this.showToast(`✓ INVITE LINK COPIED:\n${this.net.roomCode}`);
      }).catch(() => {
        this.showToast(`ROOM CODE: ${this.net.roomCode}`);
      });
    });

    // Quick Join on Start Screen
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
      await this.net.joinRoom(code);
      window.history.replaceState(null, '', `?room=${code}`);
      this.bridge.start1v1Match();
    };

    document.getElementById('ttwt-dock-join-btn')?.addEventListener('click', handleDockJoin);
    dockJoinInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleDockJoin();
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
