import type { IncomingMessage, ServerResponse } from 'http';

const DEFAULT_CLIENT_ID = '1565375742743805992';
const DEFAULT_CLIENT_SECRET = 'ABuyzuPQQWrQWI_mwnVczUNo46bxmeJS';

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

function sendJson(res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any }, statusCode: number, payload: unknown) {
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
    const { code, redirectUri } = body;

    if (!code || !redirectUri) {
      sendJson(res, 400, { error: 'Missing authorization code or redirectUri' });
      return;
    }

    const clientId =
      process.env.DISCORD_CLIENT_ID ||
      process.env.VITE_DISCORD_CLIENT_ID ||
      DEFAULT_CLIENT_ID;
    const clientSecret =
      process.env.DISCORD_CLIENT_SECRET ||
      DEFAULT_CLIENT_SECRET;

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: String(redirectUri),
    });

    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    const tokenData = (await tokenResp.json()) as any;
    if (!tokenResp.ok || !tokenData.access_token) {
      sendJson(res, 400, {
        error: tokenData.error_description || tokenData.error || 'Failed to exchange Discord OAuth code',
      });
      return;
    }

    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = (await userResp.json()) as any;
    if (!userResp.ok || !userData.id) {
      sendJson(res, 400, { error: 'Failed to fetch Discord user profile' });
      return;
    }

    sendJson(res, 200, {
      user: userData,
      access_token: tokenData.access_token,
    });
  } catch (err: any) {
    sendJson(res, 500, { error: err?.message || 'Internal OAuth error' });
  }
}
