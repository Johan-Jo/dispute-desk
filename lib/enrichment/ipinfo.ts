/**
 * IPinfo client — thin, dependency-free enrichment for customer purchase IPs.
 *
 * GET https://ipinfo.io/{ip}?token={IPINFO_API_KEY}
 *
 * Design: graceful degrade. Returns null on missing key, timeouts, auth
 * failures, or any non-2xx response after retries. Callers treat null as
 * "no enrichment available" and carry on — an evidence block whose
 * enrichment fails just renders as Missing in the merchant UI.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

export interface IpinfoPrivacy {
  vpn: boolean;
  proxy: boolean;
  hosting: boolean;
}

export interface IpinfoResponse {
  ip: string;
  city: string | null;
  region: string | null;
  country: string | null;
  loc: string | null;
  org: string | null;
  privacy: IpinfoPrivacy;
}

interface RawIpinfoResponse {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  privacy?: Partial<IpinfoPrivacy>;
}

export interface FetchIpinfoOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

function jitter(base: number): number {
  return base + Math.random() * base * 0.5;
}

function normalize(raw: RawIpinfoResponse, fallbackIp: string): IpinfoResponse {
  return {
    ip: raw.ip ?? fallbackIp,
    city: raw.city ?? null,
    region: raw.region ?? null,
    country: raw.country ?? null,
    loc: raw.loc ?? null,
    org: raw.org ?? null,
    privacy: {
      vpn: Boolean(raw.privacy?.vpn),
      proxy: Boolean(raw.privacy?.proxy),
      hosting: Boolean(raw.privacy?.hosting),
    },
  };
}

/**
 * Fetch IP enrichment from IPinfo.
 *
 * Returns null when:
 *  - `apiKey` is falsy (caller didn't set IPINFO_API_KEY)
 *  - all retries are exhausted on network / timeout / 5xx
 *  - any 4xx response (including auth failures) — graceful, not thrown
 *  - response body is unparseable
 */
export async function fetchIpinfo(
  ip: string,
  apiKey: string | null | undefined,
  opts: FetchIpinfoOptions = {},
): Promise<IpinfoResponse | null> {
  if (!apiKey) {
    console.warn("[ipinfo] IPINFO_API_KEY not set — skipping IP enrichment");
    return null;
  }
  if (!ip) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        (err instanceof Error && err.name === "AbortError") ||
        (err as { code?: string })?.code === "ABORT_ERR";
      if (attempt < maxRetries) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        console.warn(
          `[ipinfo] ${aborted ? "timeout" : "network error"} on attempt ${attempt + 1}; retrying in ${Math.round(delay)}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.warn(
        `[ipinfo] giving up after ${attempt + 1} attempts: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
    clearTimeout(timer);

    // 429 / 5xx → retry with backoff
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt < maxRetries) {
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        console.warn(
          `[ipinfo] HTTP ${res.status} on attempt ${attempt + 1}; retrying in ${Math.round(delay)}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.warn(`[ipinfo] giving up after HTTP ${res.status}`);
      return null;
    }

    // 4xx (auth errors, bad IP) → don't retry, just return null
    if (!res.ok) {
      console.warn(`[ipinfo] non-success HTTP ${res.status} — skipping enrichment`);
      return null;
    }

    try {
      const raw = (await res.json()) as RawIpinfoResponse;
      return normalize(raw, ip);
    } catch (err) {
      console.warn(
        `[ipinfo] failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  return null;
}
