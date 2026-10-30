import type { IncomingMessage, ServerResponse } from 'http';

interface QueuedEnvelope {
  seq: number;
  msgId: string;
  type: 'PEER_JOINED' | 'ROOM_JOINED' | 'SIGNAL' | 'PEER_LEFT' | 'ERROR';
  roomCode: string;
  from?: 'host' | 'guest';
  playerInfo?: unknown;
  hostPlayerInfo?: unknown;
  signalData?: any;
  message?: string;
}

interface RoomState {
  roomCode: string;
  hostPlayer?: unknown;
  guestPlayer?: unknown;
  hostLastSeen: number;
  guestLastSeen: number;
  guestJoinedAt?: number;
  peerJoinedNotified: boolean;
  seqCounter: number;
  messagesForHost: QueuedEnvelope[];
  messagesForGuest: QueuedEnvelope[];
  cachedOffer?: any;
  cachedAnswer?: any;
  cachedHostCandidates: any[];
  cachedGuestCandidates: any[];
  updatedAt: number;
}

const ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HOST_STALE_MS = 45 * 1000; // 45 seconds without poll = host offline

declare global {
  // eslint-disable-next-line no-var
  var __ttwtSignalingRooms: Map<string, RoomState> | undefined;
}

function getMemoryStore(): Map<string, RoomState> {
  if (!globalThis.__ttwtSignalingRooms) {
    globalThis.__ttwtSignalingRooms = new Map<string, RoomState>();
  }
  const now = Date.now();
  for (const [key, room] of globalThis.__ttwtSignalingRooms.entries()) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      globalThis.__ttwtSignalingRooms.delete(key);
    }
  }
  return globalThis.__ttwtSignalingRooms;
}

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return { url: url.replace(/\/$/, ''), token };
  }
  return null;
}

async function loadRoom(roomCode: string): Promise<RoomState | null> {
  const redis = getRedisConfig();
  if (redis) {
    try {
      const resp = await fetch(redis.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['GET', `ttwt:room:${roomCode}`]),
      });
      const data = (await resp.json()) as { result?: string | null };
      if (data?.result) {
        return JSON.parse(data.result) as RoomState;
      }
      return null;
    } catch {
      // Fallback to warm memory if Redis unreachable
    }
  }
  return getMemoryStore().get(roomCode) || null;
}

async function saveRoom(room: RoomState): Promise<void> {
  room.updatedAt = Date.now();
  const redis = getRedisConfig();
  if (redis) {
    try {
      await fetch(redis.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['SET', `ttwt:room:${room.roomCode}`, JSON.stringify(room), 'EX', '600']),
      });
      return;
    } catch {
      // Fallback to warm memory
    }
  }
  getMemoryStore().set(room.roomCode, room);
}

async function deleteRoom(roomCode: string): Promise<void> {
  const redis = getRedisConfig();
  if (redis) {
    try {
      await fetch(redis.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['DEL', `ttwt:room:${roomCode}`]),
      });
    } catch {
      // ignore
    }
  }
  getMemoryStore().delete(roomCode);
}

function makeId(prefix = 'srv'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyRoom(roomCode: string): RoomState {
  const now = Date.now();
  return {
    roomCode,
    hostLastSeen: 0,
    guestLastSeen: 0,
    peerJoinedNotified: false,
    seqCounter: 0,
    messagesForHost: [],
    messagesForGuest: [],
    cachedHostCandidates: [],
    cachedGuestCandidates: [],
    updatedAt: now,
  };
}

function triggerHandshakeNotifications(room: RoomState) {
  if (room.peerJoinedNotified || !room.hostPlayer || !room.guestPlayer) return;
  room.peerJoinedNotified = true;

  room.messagesForHost.push({
    seq: ++room.seqCounter,
    msgId: makeId('join-h'),
    type: 'PEER_JOINED',
    roomCode: room.roomCode,
    playerInfo: room.guestPlayer,
  });

  room.messagesForGuest.push({
    seq: ++room.seqCounter,
    msgId: makeId('join-g'),
    type: 'ROOM_JOINED',
    roomCode: room.roomCode,
    hostPlayerInfo: room.hostPlayer,
  });
}

async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, any>;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const type = String(body.type || '').toUpperCase();
    const roomCode = String(body.roomCode || '').toUpperCase().trim();
    const now = Date.now();

    if (!roomCode) {
      sendJson(res, 400, { ok: false, error: 'Missing roomCode' });
      return;
    }

    if (type === 'CREATE_ROOM') {
      const room = createEmptyRoom(roomCode);
      room.hostPlayer = body.playerInfo;
      room.hostLastSeen = now;
      await saveRoom(room);
      sendJson(res, 200, { ok: true, roomCode, cursor: 0, messages: [] });
      return;
    }

    if (type === 'JOIN_ROOM') {
      let room = await loadRoom(roomCode);
      const hostAlive = room && room.hostPlayer && now - room.hostLastSeen < HOST_STALE_MS;

      if (!room) {
        // Provisional room in case warm lambda switched; Host's 400ms poll will self-heal it immediately
        room = createEmptyRoom(roomCode);
      }

      // Reset previous guest handshake if re-joining
      room.guestPlayer = body.playerInfo;
      room.guestLastSeen = now;
      room.guestJoinedAt = now;
      room.peerJoinedNotified = false;
      room.cachedAnswer = undefined;
      room.cachedGuestCandidates = [];

      if (hostAlive) {
        triggerHandshakeNotifications(room);
      }

      await saveRoom(room);

      const initialMessages = room.messagesForGuest.slice();
      const cursor = initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].seq : 0;

      sendJson(res, 200, {
        ok: true,
        roomCode,
        cursor,
        messages: initialMessages,
        pendingHostSync: !hostAlive,
      });
      return;
    }

    if (type === 'SIGNAL') {
      const from: 'host' | 'guest' = body.from === 'guest' || body.senderRole === 'guest' ? 'guest' : 'host';
      let room = await loadRoom(roomCode);
      if (!room) {
        room = createEmptyRoom(roomCode);
      }

      if (from === 'host') {
        room.hostLastSeen = now;
        if (body.playerInfo && !room.hostPlayer) room.hostPlayer = body.playerInfo;
      } else {
        room.guestLastSeen = now;
        if (body.playerInfo && !room.guestPlayer) room.guestPlayer = body.playerInfo;
      }

      const signalData = body.signalData;
      if (signalData?.sdp) {
        if (from === 'host') room.cachedOffer = signalData.sdp;
        else room.cachedAnswer = signalData.sdp;
      }
      if (signalData?.candidate) {
        if (from === 'host') room.cachedHostCandidates.push(signalData.candidate);
        else room.cachedGuestCandidates.push(signalData.candidate);
      }

      const env: QueuedEnvelope = {
        seq: ++room.seqCounter,
        msgId: body.msgId || makeId('sig'),
        type: 'SIGNAL',
        roomCode,
        from,
        signalData,
      };

      if (from === 'host') {
        room.messagesForGuest.push(env);
      } else {
        room.messagesForHost.push(env);
      }

      await saveRoom(room);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (type === 'PEER_LEFT') {
      const from: 'host' | 'guest' = body.senderRole === 'guest' ? 'guest' : 'host';
      const room = await loadRoom(roomCode);
      if (room) {
        const leaveEnv: QueuedEnvelope = {
          seq: ++room.seqCounter,
          msgId: body.msgId || makeId('left'),
          type: 'PEER_LEFT',
          roomCode,
          from,
        };
        if (from === 'host') {
          room.hostPlayer = undefined;
          room.messagesForGuest.push(leaveEnv);
        } else {
          room.guestPlayer = undefined;
          room.peerJoinedNotified = false;
          room.messagesForHost.push(leaveEnv);
        }
        await saveRoom(room);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (type === 'POLL') {
      const role: 'host' | 'guest' = body.role === 'guest' ? 'guest' : 'host';
      const cursor = Number(body.cursor || 0);
      let room = await loadRoom(roomCode);

      if (!room) {
        if (role === 'host' && body.playerInfo) {
          // Self-heal host room if serverless container recycled while waiting in lobby
          room = createEmptyRoom(roomCode);
          room.hostPlayer = body.playerInfo;
          room.hostLastSeen = now;
          await saveRoom(room);
          sendJson(res, 200, { ok: true, cursor: 0, messages: [] });
          return;
        }
        sendJson(res, 200, {
          ok: false,
          cursor,
          messages: [
            {
              seq: cursor + 1,
              msgId: makeId('err'),
              type: 'ERROR',
              roomCode,
              message: `Room ${roomCode} not found or host offline.`,
            },
          ],
        });
        return;
      }

      let mutated = false;

      if (role === 'host') {
        room.hostLastSeen = now;
        if (!room.hostPlayer && body.playerInfo) {
          room.hostPlayer = body.playerInfo;
          mutated = true;
        }
        if (body.localSdp && !room.cachedOffer) {
          room.cachedOffer = body.localSdp;
          mutated = true;
        }
      } else {
        room.guestLastSeen = now;
        if (!room.guestPlayer && body.playerInfo) {
          room.guestPlayer = body.playerInfo;
          room.guestJoinedAt = room.guestJoinedAt || now;
          mutated = true;
        }
        if (body.localSdp && !room.cachedAnswer) {
          room.cachedAnswer = body.localSdp;
          mutated = true;
        }

        // If Guest has been waiting > 4.5s and no Host has ever checked in, the room code doesn't exist
        const hostPresent = room.hostPlayer && now - room.hostLastSeen < HOST_STALE_MS;
        if (!hostPresent && room.guestJoinedAt && now - room.guestJoinedAt > 4500) {
          await deleteRoom(roomCode);
          sendJson(res, 200, {
            ok: false,
            cursor,
            messages: [
              {
                seq: cursor + 1,
                msgId: makeId('err'),
                type: 'ERROR',
                roomCode,
                message: `Room ${roomCode} not found or host offline.`,
              },
            ],
          });
          return;
        }
      }

      if (!room.peerJoinedNotified && room.hostPlayer && room.guestPlayer) {
        triggerHandshakeNotifications(room);
        mutated = true;
      }

      // Always persist updated heartbeat timestamps so the peer knows we're alive
      if (mutated || now - room.updatedAt > 1500) {
        await saveRoom(room);
      } else {
        room.updatedAt = now;
      }

      const queue = role === 'host' ? room.messagesForHost : room.messagesForGuest;
      const newMessages = queue.filter((m) => m.seq > cursor);
      const nextCursor = newMessages.length > 0 ? newMessages[newMessages.length - 1].seq : cursor;

      sendJson(res, 200, {
        ok: true,
        cursor: nextCursor,
        messages: newMessages,
        cachedPeerSdp: role === 'host' ? room.cachedAnswer : room.cachedOffer,
        cachedPeerCandidates: role === 'host' ? room.cachedGuestCandidates : room.cachedHostCandidates,
      });
      return;
    }

    sendJson(res, 400, { ok: false, error: `Unknown signaling type: ${type}` });
  } catch (err: any) {
    sendJson(res, 500, { ok: false, error: err?.message || 'Internal signaling error' });
  }
}
