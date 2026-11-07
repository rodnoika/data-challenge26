// The organisers' player page issues a short-lived mp3 link, so a resolved link can only be reused until it expires.
const FALLBACK_TTL_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

export function audioLinkExpiry(url: string, now = Date.now()): number {
  let expiresAt = NaN;
  try {
    expiresAt = Date.parse(new URL(url).searchParams.get("se") ?? "");
  } catch {
    // not an absolute URL: use the fallback below
  }
  return Number.isFinite(expiresAt) ? expiresAt - EXPIRY_MARGIN_MS : now + FALLBACK_TTL_MS;
}

/** Fetches the recording; if the upstream rejects the link, resolves a fresh one and retries once. */
export async function fetchAudioWithRefresh(
  resolve: (fresh: boolean) => Promise<string>,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const first = await fetchImpl(await resolve(false), { headers, cache: "no-store" });
  // 416 means the requested byte range is wrong, not the link.
  if (first.ok || first.status === 416) return first;
  await first.body?.cancel();
  return fetchImpl(await resolve(true), { headers, cache: "no-store" });
}
