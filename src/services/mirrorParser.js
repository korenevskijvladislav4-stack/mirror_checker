function toUrlObject(raw) {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  try {
    return s.includes("://") ? new URL(s) : new URL(`https://${s}`);
  } catch {
    return null;
  }
}

export function extractMirrorNumber(url) {
  const u = toUrlObject(url);
  if (!u) return null;
  const host = u.host; // например: roxcasino1697.com

  // Ищем последнюю группу цифр перед TLD.
  const m = host.match(/(\d+)(?=\.[^.]+$)/);
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isFinite(num) ? num : null;
}

export function buildNextMirrorUrl(currentUrl, nextNumber) {
  const u = toUrlObject(currentUrl);
  if (!u) return null;
  const host = u.host;

  const m = host.match(/(\d+)(?=\.[^.]+$)/);
  if (!m) return null;

  const numStr = m[1];
  const start = m.index;
  const end = start + numStr.length;

  const prefix = host.slice(0, start);
  const suffix = host.slice(end);

  const scheme = u.protocol && u.protocol !== ":" ? u.protocol.replace(":", "") : "https";
  const newHost = `${prefix}${nextNumber}${suffix}`;

  return `${scheme}://${newHost}${u.pathname || ""}`;
}

