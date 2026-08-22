import type { PublicState } from './minna';

const DEFAULT_API_URL = 'https://minna-exe-live.saber5656.chatgpt.site';
const API_URL = (process.env.EXPO_PUBLIC_MINNA_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 8_000;

export class MinnaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`MINNA API failed: ${status} ${code}`);
  }
}

export async function readRoom(roomCode: string) {
  const response = await fetchWithTimeout(`${API_URL}/api/session?room=${encodeURIComponent(roomCode)}`, {
    headers: { accept: 'application/json', 'cache-control': 'no-store' },
  });
  return stateFromResponse(response);
}

export async function postAudience(
  action: 'join' | 'heartbeat' | 'answer' | 'hold-start' | 'hold-stop' | 'firework',
  clientId: string,
  roomCode: string,
  extra: Record<string, string> = {},
) {
  const response = await fetchWithTimeout(`${API_URL}/api/session`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ action, clientId, roomCode, ...extra }),
  });
  return stateFromResponse(response);
}

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function stateFromResponse(response: Response) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new MinnaApiError(response.status, payload?.error ?? 'request-failed');
  }
  return response.json() as Promise<PublicState>;
}
