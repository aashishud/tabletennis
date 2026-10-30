import type { DiscordAuthManager, PlayerIdentity } from './auth';
import type { MultiplayerBridge } from './multiplayer-bridge';
import type { ConnectionStatus, WebRTCRoomManager } from './network';

export class LobbyOverlayUI {
  private root: HTMLElement;
  private auth: DiscordAuthManager;
  private net: WebRTCRoomManager;
  private bridge: MultiplayerBridge;
  private modalOpen = false;
  private statusText = 'Ready for 1v1 P2P or Solo World Tour';

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

    this.auth.onChange((user) => {
      this.net.setLocalPlayer(user);
      this.render();
    });

    this.net.onStatusChange((status, detail) => {
      if (detail) this.statusText = detail;
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
          pingEl.textContent = `${this.net.rttMs || 1}ms P2P`;
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

    this.root.innerHTML = `
      <!-- Top-Left Esports HUD Pill -->
      <div class="ttwt-hud-bar">
        <div class="ttwt-hud-user" id="ttwt-hud-profile-trigger" title="Click to open Discord Auth & 1v1 Lobby">
          <img class="ttwt-hud-avatar" src="${user.avatarUrl}" alt="${user.displayName}" />
          <div class="ttwt-hud-meta">
            <div class="ttwt-hud-name">
              <span>${this.escapeHtml(user.displayName)}</span>
            </div>
            <div class="ttwt-hud-sub">
              ${user.authProvider === 'discord' ? 'Discord Verified' : 'Dev Mock Identity'}
            </div>
          </div>
        </div>

        <span class="ttwt-badge-pill ${isConnected ? 'ttwt-badge-p2p' : 'ttwt-badge-bot'}">
          <span class="ttwt-dot ${isConnected || isWaiting ? 'ttwt-dot-pulse' : ''}"></span>
          <span id="ttwt-live-rtt">
            ${
              isConnected
                ? `${this.net.rttMs || 1}ms P2P`
                : isWaiting
                ? `Room ${this.net.roomCode}`
                : 'AI Bot Mode'
            }
          </span>
        </span>

        <button class="ttwt-btn ttwt-btn-discord" id="ttwt-open-lobby-btn">
          🏓 1v1 Lobby
        </button>

        <button class="ttwt-btn ttwt-btn-ghost" id="ttwt-quick-mock-toggle" title="Instant toggle between Sour (P1) and Player 2 for two-tab testing">
          ⚡ ${user.username === 'sour' ? 'Switch -> P2' : 'Switch -> Sour'}
        </button>
      </div>

      <!-- Auth & 1v1 Private Lobby Modal -->
      <div class="ttwt-modal-backdrop ${this.modalOpen ? '' : 'ttwt-hidden'}" id="ttwt-modal-backdrop">
        <div class="ttwt-modal-card" id="ttwt-modal-card">
          <div class="ttwt-modal-header">
            <h2 class="ttwt-modal-title">
              <span>🏓 Table Tennis 1v1 Esports Lobby</span>
            </h2>
            <button class="ttwt-close-btn" id="ttwt-close-modal-btn" title="Close">&times;</button>
          </div>

          <!-- Step 2: Discord OAuth2 & Mock Fallback -->
          <div class="ttwt-section">
            <div class="ttwt-section-label">
              <span>Player Identity (Above-Paddle Tag)</span>
              <span>App ID: ${this.auth.getDiscordClientId().slice(0, 8)}...</span>
            </div>

            <div class="ttwt-profile-row">
              <div class="ttwt-profile-info">
                <img class="ttwt-profile-avatar-lg" src="${user.avatarUrl}" alt="${user.displayName}" />
                <div>
                  <div style="font-size: 16px; font-weight: 800; color: #fff;">
                    ${this.escapeHtml(user.displayName)}
                  </div>
                  <div style="font-size: 12px; color: #94a3b8;">
                    @${this.escapeHtml(user.username)} • ${
      user.authProvider === 'discord' ? 'Discord OAuth2' : 'Local Dev Mock'
    }
                  </div>
                </div>
              </div>

              <button class="ttwt-btn ttwt-btn-discord" id="ttwt-discord-oauth-btn">
                <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor">
                  <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.8 58.8 0 0018 9.1.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.6 58.6 0 0070.4 45.6v-.1c1.4-15-2.3-28.4-10.2-40.5a.2.2 0 00-.1-.1zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1zm23.7 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1z"/>
                </svg>
                Login with Discord
              </button>
            </div>

            <div class="ttwt-mock-toggles">
              <button class="ttwt-mock-chip ${user.username === 'sour' ? 'active' : ''}" data-mock="sour">
                👑 Dev Login: Sour (P1)
              </button>
              <button class="ttwt-mock-chip ${user.username === 'player_two' ? 'active' : ''}" data-mock="player2">
                🔥 Dev Login: Player 2 (P2)
              </button>
              <button class="ttwt-mock-chip ${user.username === 'kanto_ace' ? 'active' : ''}" data-mock="ace">
                ⚡ Dev Login: KantoAce
              </button>
            </div>
          </div>

          <!-- Step 4: WebRTC P2P Private Lobby -->
          <div class="ttwt-section">
            <div class="ttwt-section-label">
              <span>1v1 Private Lobby (WebRTC P2P UDP)</span>
              <span style="color: ${isConnected ? '#4ade80' : '#38bdf8'};">
                ${this.net.status.toUpperCase().replace(/_/g, ' ')}
              </span>
            </div>

            ${
              this.net.roomCode
                ? `
              <div class="ttwt-room-code-banner">
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">
                    Active 6-Char Room Code
                  </div>
                  <div class="ttwt-room-code-text">${this.net.roomCode}</div>
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                  <button class="ttwt-btn ttwt-btn-ghost" id="ttwt-copy-link-btn">
                    🔗 Copy Invite Link
                  </button>
                  ${
                    this.net.role === 'host' && !isConnected
                      ? `
                    <button class="ttwt-btn ttwt-btn-cyan" id="ttwt-spawn-p2-tab-btn" title="Opens a second tab logged in as Player 2 and auto-connects via WebRTC!">
                      🚀 Open P2 Test Tab
                    </button>
                  `
                      : ''
                  }
                  <button class="ttwt-btn ttwt-btn-ghost" id="ttwt-leave-room-btn">
                    Leave
                  </button>
                </div>
              </div>
            `
                : `
              <div class="ttwt-lobby-grid">
                <div class="ttwt-lobby-box">
                  <div style="font-size: 13px; font-weight: 700;">Host Private Match</div>
                  <div style="font-size: 11px; color: #94a3b8;">
                    Generate a 6-character code & invite a friend.
                  </div>
                  <button class="ttwt-btn ttwt-btn-cyan" id="ttwt-create-room-btn" style="margin-top: auto;">
                    ✨ Create Match
                  </button>
                </div>

                <div class="ttwt-lobby-box">
                  <div style="font-size: 13px; font-weight: 700;">Join with Room Code</div>
                  <input
                    type="text"
                    maxlength="6"
                    placeholder="E.G. 849K2X"
                    class="ttwt-input"
                    id="ttwt-join-code-input"
                  />
                  <button class="ttwt-btn ttwt-btn-emerald" id="ttwt-join-room-btn">
                    ⚡ Join Match
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
                  <img src="${user.avatarUrl}" alt="${user.displayName}" style="border: 2px solid #00f2fe;" />
                  <div>
                    <div style="font-size: 13px; font-weight: 800;">${this.escapeHtml(user.displayName)}</div>
                    <div style="font-size: 10px; color: #00f2fe;">YOU (${this.net.role?.toUpperCase()})</div>
                  </div>
                </div>

                <div style="font-size: 16px; font-weight: 900; color: #f43f5e; letter-spacing: 0.08em;">
                  VS
                </div>

                <div class="ttwt-vs-player">
                  <div style="text-align: right;">
                    <div style="font-size: 13px; font-weight: 800;">${this.escapeHtml(remote.displayName)}</div>
                    <div style="font-size: 10px; color: #ff477e;">OPPONENT</div>
                  </div>
                  <img src="${remote.avatarUrl}" alt="${remote.displayName}" style="border: 2px solid #ff477e;" />
                </div>
              </div>

              <button class="ttwt-btn ttwt-btn-emerald" id="ttwt-start-p2p-match-btn" style="width: 100%; padding: 12px; font-size: 14px;">
                🏓 Start 1v1 P2P Match Now!
              </button>
            `
                : ''
            }

            <div class="ttwt-status-line">
              <span>${this.escapeHtml(this.statusText)}</span>
              ${
                this.bridge.mode === 'NETWORK_MODE'
                  ? `<button class="ttwt-btn ttwt-btn-ghost" id="ttwt-switch-bot-btn" style="padding: 4px 9px; font-size: 10.5px;">Switch to AI Bot</button>`
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
        this.statusText = res.error;
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
        this.statusText = 'Please enter a valid 6-character room code.';
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
        this.statusText = `Copied share link: ${url}`;
      } catch {
        this.statusText = `Share link: ${url}`;
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
      this.statusText = 'Disconnected from room. Returned to AI Bot mode.';
      this.render();
    });

    document.getElementById('ttwt-start-p2p-match-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.bridge.startMultiplayerMatch(true);
    });

    document.getElementById('ttwt-switch-bot-btn')?.addEventListener('click', () => {
      this.bridge.setMode('BOT_MODE');
      this.statusText = 'Switched enemyBat to BOT_MODE.';
      this.render();
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
