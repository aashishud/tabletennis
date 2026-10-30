import './style.css';
import { DiscordAuthManager } from './auth';
import { WebRTCRoomManager } from './network';
import { MultiplayerBridge } from './multiplayer-bridge';
import { LobbyOverlayUI } from './lobby-ui';

async function bootstrapMultiplayerApp() {
  const auth = new DiscordAuthManager();
  const net = new WebRTCRoomManager(auth.getUser());
  const bridge = new MultiplayerBridge(auth, net);

  // Expose bridge globally for js/app.js hooks
  window.TTWTMultiplayer = bridge;

  const ui = new LobbyOverlayUI(auth, net, bridge);

  // Check if returning from Discord OAuth2 callback (?code= or #access_token=)
  await auth.handleOAuthCallbackIfPresent();

  // Check if joining a room via shareable link (?room=XXXXXX)
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam && roomParam.trim().length >= 4) {
    ui.openModal();
    await net.joinRoom(roomParam.trim().toUpperCase());
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    bootstrapMultiplayerApp();
  });
} else {
  bootstrapMultiplayerApp();
}
