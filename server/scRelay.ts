// SoundCloud egress channel — netopen client.
//
// The pod's network cannot reach soundcloud.com / api-v2.soundcloud.com
// (SNI/IP block on Iranian upstreams — verified Nov 2026: sndcdn.com media
// hosts stay reachable, the control plane does not). netopen, a tiny fetch
// service deployed on ANY open-internet host (see ../netopen), restores the
// control plane: it fetches the target URL from the open internet and
// streams the response back.
//
// Behavior of scFetch:
//   1. direct connect FIRST (dev machines, non-blocked networks, any future
//      unblock — costs ~0 when the host is reachable);
//   2. on connect-level failure (fetch throws — never a clean HTTP status),
//      the same request rides the netopen channel;
//   3. HTTP statuses (401/404/429...) are real upstream answers and always
//      pass through untouched — client_id rotation etc. keep working.
//
// Config (Music Atlas/.env):
//   NETOPEN_URL=https://your-netopen-host:8787   (or http://vps:8787)
//   NETOPEN_TOKEN=...                            (when netopen requires it)
// Unset = direct-only behavior (broken on the pod until netopen is live).

export interface NetopenStatus {
  configured: boolean
  host: string | null
  token: boolean
}

const CONNECT_TIMEOUT_MS = 20_000
const CHANNEL_TIMEOUT_MS = 40_000

let cachedToken: string | null = null
function netopenUrl(): string {
  const v = (process.env.NETOPEN_URL || '').trim().replace(/\/+$/, '')
  return v
}
function netopenToken(): string {
  if (cachedToken === null) cachedToken = (process.env.NETOPEN_TOKEN || '').trim()
  return cachedToken
}

export function netopenConfigured(): boolean {
  try {
    return !!netopenUrl() && !!new URL(netopenUrl())
  } catch {
    return false
  }
}

export function netopenStatus(): NetopenStatus {
  const url = netopenUrl()
  let host: string | null = null
  if (url) {
    try {
      host = new URL(url).hostname
    } catch { host = null }
  }
  return { configured: !!host, host, token: !!netopenToken() }
}

function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = CONNECT_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
}

/** Channel request: netopen /fetch with the target encoded + token. */
export async function netopenFetch(target: string, init?: RequestInit): Promise<Response | null> {
  const base = netopenUrl()
  if (!base) return null
  const qs = new URLSearchParams({ u: target })
  const token = netopenToken()
  if (token) qs.set('t', token)
  const headers: Record<string, string> = {}
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      // hop-by-hop/auth headers of OUR request never belong on the channel
      if (!/^authorization$|^x-netopen-token$|^host$|^connection$/i.test(k)) headers[k] = v
    }
  }
  try {
    // ANY http status proves the pipe + upstream answered (401 from a dead
    // client_id is still a working channel — rotation logic handles it).
    return await fetchWithTimeout(`${base}/fetch?${qs.toString()}`, { ...init, headers }, CHANNEL_TIMEOUT_MS)
  } catch {
    return null
  }
}

/**
 * Fetch a SoundCloud URL: direct first, netopen channel when the direct
 * connect fails. Returns the first Response with received headers, or null
 * when everything is down. Status handling stays with the caller.
 */
export async function scFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetchWithTimeout(url, init)
  } catch {
    /* direct unreachable -> channel */
  }
  return netopenFetch(url, init)
}
