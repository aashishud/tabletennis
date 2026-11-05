import './style.css';
import { DiscordAuthManager } from './auth';
import { WebRTCRoomManager } from './network';
import { MultiplayerBridge } from './multiplayer-bridge';
import { LobbyOverlayUI } from './lobby-ui';
import { mountHomePreloader } from './home-preloader';

async function bootstrapMultiplayerApp() {
  const auth = new DiscordAuthManager();
  const net = new WebRTCRoomManager(auth.getUser());
  const bridge = new MultiplayerBridge(auth, net);

  // Expose bridge globally for js/app.js hooks
  window.TTWTMultiplayer = bridge;

  const ui = new LobbyOverlayUI(auth, net, bridge);
  (window as any).TTWTLobbyUI = ui;

  // Expose replay helper for easy testing / re-triggering of the vinyl entrance
  (window as any).replayVinylPreloader = () => {
    mountHomePreloader();
  };

  // 1. Mount the Vinyl Halftone Home Screen IMMEDIATELY.
  // This guarantees the old canvas start screen is never exposed while waiting for OAuth network requests.
  mountHomePreloader();

  // 2. Handle Discord OAuth callback in the background without blocking initial render
  const oauthPromise = auth.handleOAuthCallbackIfPresent().then((user) => {
    if (user) {
      ui.showToast(`✓ LOGGED IN AS ${user.displayName.toUpperCase()}`);
    }
    return user;
  });

  // 3. Check if joining a room via shareable link (?room=XXXXXX) or returning to room after Discord OAuth
  const params = new URLSearchParams(window.location.search);
  const pendingRoom = sessionStorage.getItem('ttwt_pending_room');
  const roomParam = params.get('room') || pendingRoom;
  sessionStorage.removeItem('ttwt_pending_room');

  if (roomParam && roomParam.trim().length >= 4) {
    await oauthPromise;
    await ui.promptJoinLobby(roomParam.trim().toUpperCase());
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    bootstrapMultiplayerApp();
  });
} else {
  bootstrapMultiplayerApp();
}
