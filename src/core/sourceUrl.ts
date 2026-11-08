/**
 * The server fetches a dataset from a link the user pastes, so the link must not be able to reach
 * internal services: https only, no credentials in the URL, no IP literals, and only allowed hosts.
 * An entry starting with "." allows that domain and its subdomains.
 */
export function checkSourceUrl(raw: string, allowedHosts: string[]): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Это не ссылка. Вставьте полный адрес, начиная с https://" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Нужна ссылка https://" };
  if (url.username || url.password) return { ok: false, error: "Ссылка не должна содержать логин или пароль" };
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host === "localhost") return { ok: false, error: "Адреса IP и localhost не принимаются" };
  const allowed = allowedHosts
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .some((h) => (h.startsWith(".") ? host === h.slice(1) || host.endsWith(h) : host === h));
  if (!allowed) return { ok: false, error: `Хост ${host} не разрешён. Добавьте его в CQA_FETCH_ALLOWED_HOSTS в .env` };
  return { ok: true, url };
}

/** Hosts allowed by default: the organisers' API host and its Power Platform environment domain. */
export function defaultAllowedHosts(organiserUrl: string | undefined, extra: string | undefined): string[] {
  const hosts = [".environment.api.powerplatform.com", ...(extra ?? "").split(",")];
  try {
    if (organiserUrl) hosts.push(new URL(organiserUrl).hostname);
  } catch {}
  return hosts.map((h) => h.trim()).filter(Boolean);
}
