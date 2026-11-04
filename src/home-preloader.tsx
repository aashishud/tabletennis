import React from 'react';
import ReactDOM from 'react-dom/client';
import VinylHalftonePreloader from './experiments/VinylHalftonePreloader';

let preloaderRootInstance: ReactDOM.Root | null = null;

function HomePreloaderApp({ onFinish }: { onFinish: () => void }) {
  const [lobbyOpen, setLobbyOpen] = React.useState<boolean>(() => {
    return Boolean((window as any).TTWTLobbyUI?.isPreGameLobbyOpen?.());
  });

  React.useEffect(() => {
    (window as any).setVinylLobbyMode = (open: boolean) => {
      setLobbyOpen(open);
    };
    return () => {
      delete (window as any).setVinylLobbyMode;
    };
  }, []);

  const handleStageSelect = (index: number, _label: string) => {
    if (typeof (window as any).playSound === 'function') {
      try {
        (window as any).playSound('hit' + Math.floor(Math.random() * 6));
      } catch {}
    }

    const lobbyUI = (window as any).TTWTLobbyUI;

    if (index === 0) {
      if (lobbyUI && typeof lobbyUI.openPreGameLobbyForMode === 'function') {
        lobbyUI.openPreGameLobbyForMode('1v1');
      }
    } else if (index === 1) {
      if (lobbyUI && typeof lobbyUI.openPreGameLobbyForMode === 'function') {
        lobbyUI.openPreGameLobbyForMode('2v2');
      }
    } else if (index === 2) {
      if (lobbyUI && typeof lobbyUI.openPreGameLobbyForMode === 'function') {
        lobbyUI.openPreGameLobbyForMode('4v4');
      }
    } else if (index === 3) {
      if (lobbyUI && typeof lobbyUI.openModal === 'function') {
        lobbyUI.openModal();
      }
    }
  };

  const handleJoinRoomCode = (code: string) => {
    if (typeof (window as any).playSound === 'function') {
      try {
        (window as any).playSound('hit' + Math.floor(Math.random() * 6));
      } catch {}
    }
    const lobbyUI = (window as any).TTWTLobbyUI;
    if (lobbyUI && typeof lobbyUI.joinRoomFromHome === 'function') {
      lobbyUI.joinRoomFromHome(code);
    }
  };

  const retroArcadeLogo = (
    <div className="vhp-retro-brand">
      <div className="vhp-retro-badge">★ ONLINE PADDLE BRAWLER ★</div>
      <h1 className="vhp-retro-title">PONGPONG</h1>
      <div className="vhp-retro-sub">1V1 • 2V2 • 4V4 MULTIPLAYER</div>
      <div className="vhp-retro-meta">
        <span>33⅓ RPM STEREO · SERVE & SMASH</span>
      </div>
    </div>
  );

  return (
    <VinylHalftonePreloader
      title="PONGPONG"
      subtitle="ONLINE PADDLE BRAWL"
      customLogo={retroArcadeLogo}
      stages={['SERVE 1V1', '2V2 CO-OP', '4V4 MAYHEM', 'PROFILE']}
      interactiveMenu={true}
      lobbyOpen={lobbyOpen}
      onJoinRoomCode={handleJoinRoomCode}
      bpm={128}
      preset="rhythm"
      palette={{
        paper: '#ffe600',
        ink: '#0b061c',
        glow: '#00f0ff',
        edge: '#ff007f',
        spark: '#ffffff',
      }}
      ringText="PONGPONG  ·  33⅓ RPM STEREO  ·  SERVE & SMASH  ·  PADDLE BRAWLER  ·  2026  ·  "
      hint=""
      onSelectStage={handleStageSelect}
      onComplete={onFinish}
    />
  );
}

export function mountHomePreloader(onFinish?: () => void) {
  let container = document.getElementById('vhp-mount-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'vhp-mount-root';
    document.body.appendChild(container);
  }

  const root = ReactDOM.createRoot(container);
  preloaderRootInstance = root;

  const handleComplete = () => {
    try {
      root.unmount();
    } catch {}
    container?.remove();
    preloaderRootInstance = null;

    if (typeof onFinish === 'function') {
      onFinish();
    }
  };

  root.render(
    <React.StrictMode>
      <HomePreloaderApp onFinish={handleComplete} />
    </React.StrictMode>
  );
}
