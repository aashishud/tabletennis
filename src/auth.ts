export interface PlayerIdentity {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  authProvider: 'discord' | 'mock';
  accentColor: string;
}

const SESSION_PLAYER_KEY = 'ttwt_session_player';
const LOCAL_DISCORD_PLAYER_KEY = 'ttwt_discord_player';
const DISCORD_CLIENT_ID_KEY = 'ttwt_discord_client_id';
const PENDING_ROOM_KEY = 'ttwt_pending_room';
export const DEFAULT_DISCORD_CLIENT_ID = '1565375742743805992';

/**
 * Generates a crisp high-res SVG data URI avatar for Mock Profiles
 * so canvas rendering is instant, offline-capable, and never taints the canvas.
 */
export function createSvgAvatarDataUri(
  initials: string,
  bgGradientStart: string,
  bgGradientEnd: string,
  ringColor: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradientStart}"/>
        <stop offset="100%" stop-color="${bgGradientEnd}"/>
      </linearGradient>
    </defs>
    <circle cx="128" cy="128" r="124" fill="url(#bg)" stroke="${ringColor}" stroke-width="8"/>
    <circle cx="128" cy="102" r="42" fill="rgba(255,255,255,0.16)"/>
    <path d="M56 220 C56 168 200 168 200 220" fill="rgba(255,255,255,0.14)"/>
    <text x="128" y="148" text-anchor="middle" fill="#ffffff" font-family="Inter, system-ui, -apple-system, sans-serif" font-weight="800" font-size="76" letter-spacing="2">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const BOT_PROFILE: PlayerIdentity = {
  id: 'ttwt-ai-bot',
  username: 'ai_bot',
  displayName: 'AI Bot',
  avatarUrl: createSvgAvatarDataUri('AI', '#334155', '#0f172a', '#94a3b8'),
  authProvider: 'mock',
  accentColor: '#64748b',
};

export const MOCK_PROFILES: Record<'sour' | 'player2' | 'ace', PlayerIdentity> = {
  sour: {
    id: 'discord-mock-sour-001',
    username: 'sour',
    displayName: 'Sour',
    avatarUrl: createSvgAvatarDataUri('SR', '#5865F2', '#1e1f22', '#00f2fe'),
    authProvider: 'mock',
    accentColor: '#5865F2',
  },
  player2: {
    id: 'discord-mock-p2-002',
    username: 'player_two',
    displayName: 'Player 2',
    avatarUrl: createSvgAvatarDataUri('P2', '#eb459e', '#2b2d31', '#ff477e'),
    authProvider: 'mock',
    accentColor: '#EB459E',
  },
  ace: {
    id: 'discord-mock-ace-003',
    username: 'kanto_ace',
    displayName: 'KantoAce',
    avatarUrl: createSvgAvatarDataUri('KA', '#23a55a', '#111214', '#57f287'),
    authProvider: 'mock',
    accentColor: '#23A55A',
  },
};

export class DiscordAuthManager {
  private currentUser: PlayerIdentity;
  private listeners: Array<(user: PlayerIdentity) => void> = [];
  private avatarImageCache = new Map<string, HTMLImageElement>();

  constructor() {
    this.currentUser = this.loadInitialIdentity();
    this.preloadAvatar(this.currentUser.avatarUrl);
  }

  private loadInitialIdentity(): PlayerIdentity {
    const params = new URLSearchParams(window.location.search);
    const mockParam = params.get('mock')?.toLowerCase();

    if (mockParam === 'p2' || mockParam === 'player2') {
      this.saveSessionIdentity(MOCK_PROFILES.player2);
      return MOCK_PROFILES.player2;
    }
    if (mockParam === 'p1' || mockParam === 'sour') {
      this.saveSessionIdentity(MOCK_PROFILES.sour);
      return MOCK_PROFILES.sour;
    }

    // Check per-tab sessionStorage first so Tab 1 and Tab 2 can hold distinct identities
    const sessionRaw = sessionStorage.getItem(SESSION_PLAYER_KEY);
    if (sessionRaw) {
      try {
        return JSON.parse(sessionRaw) as PlayerIdentity;
      } catch {
        // ignore malformed JSON
      }
    }

    // Check persisted Discord OAuth login
    const discordRaw = localStorage.getItem(LOCAL_DISCORD_PLAYER_KEY);
    if (discordRaw) {
      try {
        const parsed = JSON.parse(discordRaw) as PlayerIdentity;
        this.saveSessionIdentity(parsed);
        return parsed;
      } catch {
        // ignore malformed JSON
      }
    }

    // If URL has ?room=..., default a fresh joining tab to Player 2 for instant 2-tab testing
    if (params.has('room')) {
      this.saveSessionIdentity(MOCK_PROFILES.player2);
      return MOCK_PROFILES.player2;
    }

    // Default to Dev Login: Sour
    this.saveSessionIdentity(MOCK_PROFILES.sour);
    return MOCK_PROFILES.sour;
  }

  private saveSessionIdentity(user: PlayerIdentity) {
    sessionStorage.setItem(SESSION_PLAYER_KEY, JSON.stringify(user));
  }

  public getUser(): PlayerIdentity {
    return this.currentUser;
  }

  public onChange(cb: (user: PlayerIdentity) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    this.preloadAvatar(this.currentUser.avatarUrl);
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  public loginWithMock(presetKey: 'sour' | 'player2' | 'ace', customDisplayName?: string) {
    const base = MOCK_PROFILES[presetKey];
    const displayName = customDisplayName?.trim() || base.displayName;
    const initials = displayName.slice(0, 2).toUpperCase();
    const updated: PlayerIdentity = {
      ...base,
      id: `${base.id}-${Math.random().toString(36).slice(2, 6)}`,
      displayName,
      username: displayName.toLowerCase().replace(/\s+/g, '_'),
      avatarUrl:
        presetKey === 'sour'
          ? createSvgAvatarDataUri(initials, '#5865F2', '#1e1f22', '#00f2fe')
          : presetKey === 'player2'
          ? createSvgAvatarDataUri(initials, '#eb459e', '#2b2d31', '#ff477e')
          : createSvgAvatarDataUri(initials, '#23a55a', '#111214', '#57f287'),
    };
    this.currentUser = updated;
    this.saveSessionIdentity(updated);
    this.notify();
  }

  public getDiscordClientId(): string {
    const envClientId = (import.meta as any).env?.VITE_DISCORD_CLIENT_ID || DEFAULT_DISCORD_CLIENT_ID;
    return localStorage.getItem(DISCORD_CLIENT_ID_KEY) || envClientId;
  }

  public setDiscordClientId(clientId: string) {
    localStorage.setItem(DISCORD_CLIENT_ID_KEY, clientId.trim());
  }

  /**
   * Starts the Discord OAuth2 Authorization Code flow (`response_type=code&scope=identify`)
   * backed by the `/api/auth/discord/token` exchange endpoint (with automatic Implicit `#access_token` fallback).
   */
  public startDiscordOAuth(overrideClientId?: string, grantType: 'code' | 'token' = 'code'): { ok: boolean; error?: string } {
    if (overrideClientId !== undefined && overrideClientId.trim()) {
      this.setDiscordClientId(overrideClientId);
    }
    const clientId = this.getDiscordClientId();
    if (!clientId) {
      return {
        ok: false,
        error: 'Enter your Discord Application Client ID first.',
      };
    }

    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      sessionStorage.setItem(PENDING_ROOM_KEY, room);
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const oauthUrl =
      `https://discord.com/api/oauth2/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=${grantType}` +
      `&scope=${encodeURIComponent('identify')}`;

    window.location.href = oauthUrl;
    return { ok: true };
  }

  private mapDiscordApiUser(data: any): PlayerIdentity {
    const isAnimated = data.avatar && String(data.avatar).startsWith('a_');
    const ext = isAnimated ? 'gif' : 'png';
    const avatarUrl = data.avatar
      ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${ext}?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(data.id || '0') >> 22n) % 6}.png`;

    return {
      id: data.id,
      username: data.username,
      displayName: data.global_name || data.username,
      avatarUrl,
      authProvider: 'discord',
      accentColor: '#5865F2',
    };
  }

  /**
   * Handles both `?code=...` (Authorization Code flow) and `#access_token=...` (Implicit Grant flow)
   * when returning from Discord OAuth2 redirect.
   */
  public async handleOAuthCallbackIfPresent(): Promise<PlayerIdentity | null> {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');

    if (code) {
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const pendingRoom = sessionStorage.getItem(PENDING_ROOM_KEY) || searchParams.get('room');
      sessionStorage.removeItem(PENDING_ROOM_KEY);
      const cleanSearch = pendingRoom ? `?room=${encodeURIComponent(pendingRoom)}` : '';
      window.history.replaceState({}, document.title, `${window.location.pathname}${cleanSearch}`);

      try {
        const resp = await fetch('/api/auth/discord/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirectUri }),
        });
        const result = await resp.json();
        if (!resp.ok || !result.user) {
          throw new Error(result.error || 'Token exchange failed');
        }
        const discordUser = this.mapDiscordApiUser(result.user);
        this.currentUser = discordUser;
        this.saveSessionIdentity(discordUser);
        localStorage.setItem(LOCAL_DISCORD_PLAYER_KEY, JSON.stringify(discordUser));
        this.notify();
        return discordUser;
      } catch (err) {
        console.error('[Discord OAuth Code Exchange Error]', err);
        return null;
      }
    }

    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) {
      return null;
    }

    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    if (!accessToken) return null;

    const pendingRoom = sessionStorage.getItem(PENDING_ROOM_KEY);
    sessionStorage.removeItem(PENDING_ROOM_KEY);
    const cleanSearch = pendingRoom ? `?room=${encodeURIComponent(pendingRoom)}` : window.location.search;
    window.history.replaceState({}, document.title, `${window.location.pathname}${cleanSearch}`);

    try {
      const response = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Discord API returned ${response.status}`);
      }
      const data = await response.json();
      const discordUser = this.mapDiscordApiUser(data);

      this.currentUser = discordUser;
      this.saveSessionIdentity(discordUser);
      localStorage.setItem(LOCAL_DISCORD_PLAYER_KEY, JSON.stringify(discordUser));
      this.notify();
      return discordUser;
    } catch (err) {
      console.error('[Discord OAuth] Failed to fetch profile:', err);
      return null;
    }
  }

  public preloadAvatar(url: string): HTMLImageElement {
    if (this.avatarImageCache.has(url)) {
      return this.avatarImageCache.get(url)!;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    this.avatarImageCache.set(url, img);
    return img;
  }
}
