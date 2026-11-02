import type { PlayerIdentity } from './auth';

export type NetworkRole = 'host' | 'guest' | null;
export type ConnectionStatus = 'disconnected' | 'waiting_for_peer' | 'handshaking' | 'connected' | 'error';

export interface PaddleMovePacket {
  type: 'PADDLE_MOVE';
  normX: number; // -1 to 1 from table center
  normY: number; // 0 to 1 behind baseline
  seq: number;
}

export interface BallHitPacket {
  type: 'BALL_HIT';
  isServe: boolean;
  tablePosX: number;
  tablePosY: number;
  height: number;
  hitData: {
    x: number;
    y: number;
    speed: number;
    spin: number;
  };
  rallyHits: number;
}

export interface BallMissPacket {
  type: 'BALL_MISS';
  reason: 'bottom_out' | 'off_table';
  lastHit: 'user' | 'enemy';
  bounceNum: number;
  ballShortState: number;
}

export interface PointResultPacket {
  type: 'POINT_RESULT';
  hostScore: number;
  guestScore: number;
  pointWinner: 'host' | 'guest';
  nextServer: 'host' | 'guest';
  serveFlip: boolean;
  rallyHits: number;
}

export interface MatchControlPacket {
  type: 'MATCH_START' | 'MATCH_REMATCH' | 'MATCH_FORFEIT' | 'PLAYER_INFO' | 'PING' | 'PONG';
  playerInfo?: PlayerIdentity;
  timestamp?: number;
  cupId?: number;
  gameId?: number;
  mapId?: string;
  hostPaddleColor?: string;
  guestPaddleColor?: string;
  by?: string | null;
}

export interface LobbyUpdatePacket {
  type: 'LOBBY_UPDATE';
  mapId?: string;
  paddleColor?: string;
  senderRole?: 'host' | 'guest' | null;
}

export interface PeerPausedPacket {
  type: 'PEER_PAUSED';
  paused: boolean;
  username?: string;
}

export type GamePacket =
  | PaddleMovePacket
  | BallHitPacket
  | BallMissPacket
  | PointResultPacket
  | MatchControlPacket
  | LobbyUpdatePacket
  | PeerPausedPacket;

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const env = (import.meta as any).env || {};
  if (env.VITE_TURN_URL) {
    servers.push({
      urls: env.VITE_TURN_URL,
      username: env.VITE_TURN_USERNAME || undefined,
      credential: env.VITE_TURN_CREDENTIAL || undefined,
    });
  }

  return servers;
}

export class WebRTCRoomManager {
  public role: NetworkRole = null;
  public roomCode: string = '';
  public status: ConnectionStatus = 'disconnected';
  public remotePlayer: PlayerIdentity | null = null;
  public rttMs: number = 0;

  private localPlayer: PlayerIdentity;
  private peerConnection: RTCPeerConnection | null = null;
  private fastChannel: RTCDataChannel | null = null;
  private reliableChannel: RTCDataChannel | null = null;

  private bcSignal: BroadcastChannel | null = null;
  private pollInterval: number | null = null;
  private pollCursor = 0;
  private pollInFlight = false;
  private sessionToken = 0;

  private processedSignalIds = new Set<string>();
  private appliedCandidateKeys = new Set<string>();
  private appliedRemoteSdpType: string | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private localCandidates: RTCIceCandidateInit[] = [];
  private offerStarted = false;
  private isWebRTCConnected = false;
  private handshakeTimer: number | null = null;
  private candidateSyncTimer: number | null = null;
  private outgoingRelayPackets: GamePacket[] = [];
  private pingInterval: number | null = null;

  private statusListeners: Array<(status: ConnectionStatus, detail?: string) => void> = [];
  private packetListeners: Array<(packet: GamePacket) => void> = [];
  private peerListeners: Array<(peer: PlayerIdentity | null) => void> = [];

  constructor(initialPlayer: PlayerIdentity) {
    this.localPlayer = initialPlayer;
  }

  public setLocalPlayer(player: PlayerIdentity) {
    this.localPlayer = player;
    if (this.status === 'connected') {
      this.sendReliable({
        type: 'PLAYER_INFO',
        playerInfo: this.localPlayer,
      });
    }
  }

  public onStatusChange(cb: (status: ConnectionStatus, detail?: string) => void) {
    this.statusListeners.push(cb);
  }

  public onPacket(cb: (packet: GamePacket) => void) {
    this.packetListeners.push(cb);
  }

  public onRemotePlayerChange(cb: (peer: PlayerIdentity | null) => void) {
    this.peerListeners.push(cb);
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this.status = status;
    for (const cb of this.statusListeners) {
      cb(status, detail);
    }
  }

  private setRemotePlayer(peer: PlayerIdentity | null) {
    this.remotePlayer = peer;
    for (const cb of this.peerListeners) {
      cb(peer);
    }
  }

  public static generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Host creates a 6-character room and waits for Player 2 to join.
   */
  public async createRoom(customCode?: string): Promise<string> {
    this.disconnect();
    const token = ++this.sessionToken;
    this.role = 'host';
    this.roomCode = (customCode || WebRTCRoomManager.generateRoomCode()).toUpperCase().trim();
    this.setStatus('waiting_for_peer', `Room ${this.roomCode} ready. Waiting for Player 2...`);

    this.initBroadcastChannel();

    await this.postHttpSignal({
      type: 'CREATE_ROOM',
      roomCode: this.roomCode,
      playerInfo: this.localPlayer,
      senderRole: 'host',
    });

    if (this.sessionToken === token) {
      this.startHttpPolling(token);
    }

    return this.roomCode;
  }

  /**
   * Player 2 joins an existing 6-character room code.
   */
  public async joinRoom(code: string): Promise<void> {
    this.disconnect();
    const token = ++this.sessionToken;
    this.role = 'guest';
    this.roomCode = code.toUpperCase().trim();
    this.setStatus('handshaking', `Connecting to room ${this.roomCode}...`);

    this.initBroadcastChannel();

    // Notify local BroadcastChannel immediately for 0ms multi-tab testing
    this.sendBroadcastOnly({
      type: 'JOIN_ROOM',
      roomCode: this.roomCode,
      playerInfo: this.localPlayer,
    });

    // Notify Vercel Serverless signaling endpoint for cross-internet multiplayer
    const joinResp = await this.postHttpSignal({
      type: 'JOIN_ROOM',
      roomCode: this.roomCode,
      playerInfo: this.localPlayer,
      senderRole: 'guest',
    });

    if (this.sessionToken !== token) return;

    if (joinResp && typeof joinResp.cursor === 'number') {
      this.pollCursor = joinResp.cursor;
    }
    if (joinResp?.peerPlayerInfo && !this.remotePlayer) {
      this.setRemotePlayer(joinResp.peerPlayerInfo);
      this.startHandshakeWatchdog();
    }
    if (Array.isArray(joinResp?.messages)) {
      for (const msg of joinResp.messages) {
        await this.handleSignalingMessage(msg);
      }
    }
    if (joinResp?.cachedPeerSdp) {
      await this.handleRemoteSDP(joinResp.cachedPeerSdp);
    }
    if (Array.isArray(joinResp?.cachedPeerCandidates)) {
      for (const cand of joinResp.cachedPeerCandidates) {
        await this.handleRemoteCandidate(cand);
      }
    }

    if (!this.isWebRTCConnected && this.status !== 'error') {
      this.startHttpPolling(token);
    }
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.bcSignal = new BroadcastChannel('ttwt-webrtc-signaling-v1');
      this.bcSignal.onmessage = (ev) => {
        void this.handleSignalingMessage(ev.data);
      };
    }
  }

  private startHttpPolling(token: number) {
    this.stopHttpPolling();
    this.pollInFlight = false;

    const tick = async () => {
      if (this.sessionToken !== token) return;
      if (this.isWebRTCConnected || this.status === 'disconnected' || this.status === 'error') {
        this.stopHttpPolling();
        return;
      }
      if (this.pollInFlight || !this.roomCode || !this.role) return;

      this.pollInFlight = true;
      const packetsToSend =
        this.outgoingRelayPackets.length > 0 ? this.outgoingRelayPackets.splice(0, 30) : undefined;

      try {
        const resp = await this.postHttpSignal({
          type: 'POLL',
          roomCode: this.roomCode,
          role: this.role,
          cursor: this.pollCursor,
          playerInfo: this.localPlayer,
          localSdp: this.peerConnection?.localDescription || undefined,
          localCandidates: this.localCandidates.length > 0 ? this.localCandidates : undefined,
          packets: packetsToSend,
        });

        if (this.sessionToken !== token || !resp) return;

        if (typeof resp.cursor === 'number' && resp.cursor > this.pollCursor) {
          this.pollCursor = resp.cursor;
        }

        // Level-triggered peer discovery safety net (self-heals if PEER_JOINED event landed on another instance)
        if (resp.peerPlayerInfo) {
          if (!this.remotePlayer) {
            this.setRemotePlayer(resp.peerPlayerInfo);
          }
          this.startHandshakeWatchdog();
          if (this.role === 'host' && !this.offerStarted) {
            await this.BeginHostOfferFlow();
          }
        }

        if (Array.isArray(resp.messages)) {
          for (const m of resp.messages) {
            await this.handleSignalingMessage(m);
          }
        }

        // Cached SDP/ICE replay safety net in case a message arrived out of band
        if (resp.cachedPeerSdp) {
          await this.handleRemoteSDP(resp.cachedPeerSdp);
        }
        if (Array.isArray(resp.cachedPeerCandidates)) {
          for (const cand of resp.cachedPeerCandidates) {
            await this.handleRemoteCandidate(cand);
          }
        }
      } finally {
        this.pollInFlight = false;
      }
    };

    // Poll every 280ms during handshake (and as relay fallback only if UDP WebRTC is blocked by firewall)
    this.pollInterval = window.setInterval(() => {
      void tick();
    }, 280);
  }

  private stopHttpPolling() {
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.pollInFlight = false;
  }

  private async postHttpSignal(payload: Record<string, any>): Promise<any> {
    try {
      const resp = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  private sendBroadcastOnly(payload: Record<string, any>) {
    if (!this.bcSignal) return;
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const envelope = { ...payload, msgId, senderRole: this.role };
    this.processedSignalIds.add(msgId);
    this.bcSignal.postMessage(envelope);
  }

  private sendSignalEnvelope(payload: Record<string, any>) {
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const envelope = {
      ...payload,
      msgId,
      senderRole: this.role,
      playerInfo: payload.playerInfo ?? this.localPlayer,
    };
    this.processedSignalIds.add(msgId);

    if (this.bcSignal) {
      this.bcSignal.postMessage(envelope);
    }

    void this.postHttpSignal(envelope);
  }

  private scheduleCandidateSync() {
    if (this.candidateSyncTimer !== null) return;
    this.candidateSyncTimer = window.setTimeout(() => {
      this.candidateSyncTimer = null;
      if (!this.roomCode || !this.role || this.isWebRTCConnected) return;
      void this.postHttpSignal({
        type: 'SIGNAL',
        roomCode: this.roomCode,
        from: this.role,
        playerInfo: this.localPlayer,
        signalData: {
          sdp: this.peerConnection?.localDescription || undefined,
          candidates: this.localCandidates,
        },
      });
    }, 90);
  }

  private startHandshakeWatchdog() {
    if (this.handshakeTimer !== null || this.status === 'connected') return;
    // If strict firewall/VPN/NAT blocks UDP DataChannel after 1.8s, auto-promote using BroadcastChannel/Relay
    // while WebRTC continues attempting direct P2P upgrade in the background.
    this.handshakeTimer = window.setTimeout(() => {
      this.handshakeTimer = null;
      if (this.status === 'handshaking' && this.remotePlayer) {
        this.onP2PConnected(false);
      }
    }, 1800);
  }

  private async BeginHostOfferFlow() {
    if (this.offerStarted) return;
    this.offerStarted = true;
    this.setStatus('handshaking', 'Player 2 joined! Negotiating WebRTC P2P DataChannel...');
    this.startHandshakeWatchdog();

    // Notify guest of host's playerInfo over BroadcastChannel as well
    this.sendBroadcastOnly({
      type: 'ROOM_JOINED',
      roomCode: this.roomCode,
      hostPlayerInfo: this.localPlayer,
    });

    await this.startWebRTCOffer();
  }

  private async handleSignalingMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.msgId && this.processedSignalIds.has(msg.msgId)) return;
    if (msg.msgId) this.processedSignalIds.add(msg.msgId);

    const roomCode = (msg.roomCode || '').toUpperCase().trim();
    if (roomCode && roomCode !== this.roomCode) return;

    if (msg.type === 'ERROR') {
      this.stopHttpPolling();
      this.setStatus('error', msg.message || 'Signaling error');
      return;
    }

    if (msg.type === 'GAME_PACKET' && msg.from !== this.role && msg.senderRole !== this.role) {
      if (msg.packet) {
        this.handleIncomingPacket(msg.packet as GamePacket);
      }
      return;
    }

    // Guest broadcast JOIN_ROOM directly via BroadcastChannel or Server forwarded PEER_JOINED
    if (
      this.role === 'host' &&
      (msg.type === 'PEER_JOINED' || (msg.type === 'JOIN_ROOM' && msg.senderRole === 'guest'))
    ) {
      if (msg.playerInfo) {
        this.setRemotePlayer(msg.playerInfo);
      }
      await this.BeginHostOfferFlow();
      return;
    }

    if (this.role === 'guest' && msg.type === 'ROOM_JOINED') {
      if (msg.hostPlayerInfo) {
        this.setRemotePlayer(msg.hostPlayerInfo);
      }
      this.startHandshakeWatchdog();
      return;
    }

    if (msg.type === 'SIGNAL') {
      if (msg.from === this.role || msg.senderRole === this.role) return;
      const signalData = msg.signalData;
      if (!signalData) return;

      if (signalData.sdp) {
        await this.handleRemoteSDP(signalData.sdp);
      }
      if (signalData.candidate) {
        await this.handleRemoteCandidate(signalData.candidate);
      }
      if (Array.isArray(signalData.candidates)) {
        for (const c of signalData.candidates) {
          await this.handleRemoteCandidate(c);
        }
      }
    }

    if (msg.type === 'PEER_LEFT') {
      this.stopHttpPolling();
      this.setStatus('disconnected', 'Opponent left the lobby.');
      this.setRemotePlayer(null);
      this.cleanupPeerConnection();
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    // Only close existing RTCPeerConnection instance without wiping appliedRemoteSdpType or pendingIceCandidates!
    this.closePeerConnectionInstance();
    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON();
        this.localCandidates.push(cand);
        // 0ms trickle over local BroadcastChannel
        this.sendBroadcastOnly({
          type: 'SIGNAL',
          roomCode: this.roomCode,
          from: this.role,
          signalData: { candidate: cand },
        });
        // Debounced batch sync over HTTP so we never flood serverless instances with concurrent requests
        this.scheduleCandidateSync();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.isWebRTCConnected = true;
        this.stopHttpPolling();
        this.onP2PConnected(true);
      }
    };

    this.peerConnection = pc;
    return pc;
  }

  private async startWebRTCOffer() {
    const pc = this.createPeerConnection();

    // High-frequency UDP-like DataChannel for paddle coordinates
    const fast = pc.createDataChannel('game-fast', {
      ordered: false,
      maxRetransmits: 0,
    });
    this.setupDataChannel(fast, 'fast');

    // Reliable DataChannel for ball hit states, score sync, and player identity
    const reliable = pc.createDataChannel('game-reliable', {
      ordered: true,
    });
    this.setupDataChannel(reliable, 'reliable');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignalEnvelope({
      type: 'SIGNAL',
      roomCode: this.roomCode,
      from: 'host',
      signalData: { sdp: pc.localDescription },
    });
  }

  private async handleRemoteSDP(sdp: RTCSessionDescriptionInit) {
    if (!sdp || !sdp.type) return;
    if (this.appliedRemoteSdpType === sdp.type) return;

    if (sdp.type === 'offer' && this.role === 'guest') {
      this.appliedRemoteSdpType = 'offer';
      this.startHandshakeWatchdog();
      const pc = this.createPeerConnection();
      pc.ondatachannel = (event) => {
        const ch = event.channel;
        if (ch.label === 'game-fast') {
          this.setupDataChannel(ch, 'fast');
        } else {
          this.setupDataChannel(ch, 'reliable');
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendSignalEnvelope({
        type: 'SIGNAL',
        roomCode: this.roomCode,
        from: 'guest',
        signalData: { sdp: pc.localDescription },
      });
    } else if (sdp.type === 'answer' && this.role === 'host' && this.peerConnection) {
      if (this.peerConnection.signalingState !== 'have-local-offer') return;
      this.appliedRemoteSdpType = 'answer';
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushPendingCandidates();
    }
  }

  private async handleRemoteCandidate(candidate: RTCIceCandidateInit) {
    if (!candidate) return;
    const key = `${candidate.sdpMid ?? ''}:${candidate.sdpMLineIndex ?? ''}:${candidate.candidate ?? ''}`;
    if (this.appliedCandidateKeys.has(key)) return;
    this.appliedCandidateKeys.add(key);

    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC ICE warning]', err);
    }
  }

  private async flushPendingCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.pendingIceCandidates.length > 0) {
      const c = this.pendingIceCandidates.shift()!;
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // ignore
      }
    }
  }

  private setupDataChannel(channel: RTCDataChannel, kind: 'fast' | 'reliable') {
    if (kind === 'fast') {
      this.fastChannel = channel;
    } else {
      this.reliableChannel = channel;
    }

    const checkOpen = () => {
      if (channel.readyState === 'open') {
        this.isWebRTCConnected = true;
        this.stopHttpPolling();
        this.onP2PConnected(true);
      }
    };

    channel.onopen = checkOpen;
    if (channel.readyState === 'open') {
      checkOpen();
    }

    channel.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data) as GamePacket;
        this.handleIncomingPacket(packet);
      } catch {
        // ignore malformed packet
      }
    };
  }

  private onP2PConnected(isDirectWebRTC = true) {
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }

    if (isDirectWebRTC) {
      this.isWebRTCConnected = true;
      this.stopHttpPolling();
    }

    const alreadyConnected = this.status === 'connected';
    this.setStatus(
      'connected',
      this.isWebRTCConnected
        ? 'Direct WebRTC P2P DataChannel active!'
        : '1v1 Arena Linked! (P2P Active)'
    );

    // Exchange verified Discord / Mock player identity
    this.sendReliable({
      type: 'PLAYER_INFO',
      playerInfo: this.localPlayer,
    });

    if (!alreadyConnected) {
      // Start RTT ping loop
      if (this.pingInterval) window.clearInterval(this.pingInterval);
      this.pingInterval = window.setInterval(() => {
        this.sendFast({
          type: 'PING',
          timestamp: performance.now(),
        });
      }, 1500);
    }
  }

  private handleIncomingPacket(packet: GamePacket) {
    if (packet.type === 'PLAYER_INFO' && packet.playerInfo) {
      this.setRemotePlayer(packet.playerInfo);
      return;
    }
    if (packet.type === 'PING' && packet.timestamp) {
      this.sendFast({
        type: 'PONG',
        timestamp: packet.timestamp,
      });
      return;
    }
    if (packet.type === 'PONG' && packet.timestamp) {
      this.rttMs = Math.max(1, Math.round(performance.now() - packet.timestamp));
      return;
    }

    for (const cb of this.packetListeners) {
      cb(packet);
    }
  }

  public sendFast(packet: GamePacket) {
    const ch = this.fastChannel?.readyState === 'open' ? this.fastChannel : this.reliableChannel;
    if (ch && ch.readyState === 'open') {
      try {
        ch.send(JSON.stringify(packet));
        return;
      } catch {}
    }

    // Fallback transport if UDP WebRTC is still negotiating or blocked by strict NAT
    this.sendBroadcastOnly({
      type: 'GAME_PACKET',
      roomCode: this.roomCode,
      from: this.role,
      packet,
    });
    if (!this.isWebRTCConnected) {
      // Replace older queued PADDLE_MOVE so relay queue stays ultra-fresh
      if (packet.type === 'PADDLE_MOVE') {
        this.outgoingRelayPackets = this.outgoingRelayPackets.filter((p) => p.type !== 'PADDLE_MOVE');
      }
      this.outgoingRelayPackets.push(packet);
    }
  }

  public sendReliable(packet: GamePacket) {
    const ch = this.reliableChannel?.readyState === 'open' ? this.reliableChannel : this.fastChannel;
    if (ch && ch.readyState === 'open') {
      try {
        ch.send(JSON.stringify(packet));
        return;
      } catch {}
    }

    // Fallback transport if UDP WebRTC is still negotiating or blocked by strict NAT
    this.sendBroadcastOnly({
      type: 'GAME_PACKET',
      roomCode: this.roomCode,
      from: this.role,
      packet,
    });
    if (!this.isWebRTCConnected) {
      this.outgoingRelayPackets.push(packet);
    }
  }

  private closePeerConnectionInstance() {
    if (this.fastChannel) {
      try {
        this.fastChannel.close();
      } catch {}
      this.fastChannel = null;
    }
    if (this.reliableChannel) {
      try {
        this.reliableChannel.close();
      } catch {}
      this.reliableChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.localCandidates = [];
  }

  private cleanupPeerConnection() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.candidateSyncTimer !== null) {
      window.clearTimeout(this.candidateSyncTimer);
      this.candidateSyncTimer = null;
    }
    this.closePeerConnectionInstance();
    this.pendingIceCandidates = [];
    this.appliedRemoteSdpType = null;
    this.appliedCandidateKeys.clear();
    this.offerStarted = false;
    this.isWebRTCConnected = false;
    this.outgoingRelayPackets = [];
  }

  public disconnect() {
    this.sessionToken++;
    this.stopHttpPolling();

    if (this.roomCode && this.role) {
      this.sendBroadcastOnly({
        type: 'PEER_LEFT',
        roomCode: this.roomCode,
      });
      void this.postHttpSignal({
        type: 'PEER_LEFT',
        roomCode: this.roomCode,
        senderRole: this.role,
      });
    }

    this.cleanupPeerConnection();
    if (this.bcSignal) {
      try {
        this.bcSignal.close();
      } catch {}
      this.bcSignal = null;
    }

    this.pollCursor = 0;
    this.processedSignalIds.clear();
    this.role = null;
    this.roomCode = '';
    this.setRemotePlayer(null);
    this.setStatus('disconnected');
  }
}
