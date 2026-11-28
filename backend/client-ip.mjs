import { isIP } from "node:net";

const canonicalIp = value => {
  if (typeof value !== "string") return "";
  const ip = value.toLowerCase().replace(/^::ffff:/, "");
  if (!isIP(ip) || ip.includes("%")) return "";
  if (isIP(ip) === 4) return ip;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (!mapped) return normalized;
  const [first, second] = mapped.slice(1).map(part => parseInt(part, 16));
  return [first >> 8, first & 255, second >> 8, second & 255].join(".");
};

const trustedPeers = new Set((process.env.BLOOM_TRUSTED_PROXY_IPS || "").split(",").map(value => canonicalIp(value.trim())).filter(Boolean));
export const CLIENT_IP_HEADER = "x-delight-client-ip";

export function clientIp(request) {
  const peer = canonicalIp(request.socket?.remoteAddress);
  if (trustedPeers.has(peer)) return canonicalIp(request.headers[CLIENT_IP_HEADER]) || peer;
  return peer || "0.0.0.0";
}

export function fixedWindowLimit({ max, duration, capacity = 4096, now = Date.now }) {
  let window = -1;
  const counts = new Map();
  return key => {
    const current = Math.floor(now() / duration);
    if (current !== window) {
      window = current;
      counts.clear();
    }
    const count = counts.get(key) || 0;
    if (count >= max || (!counts.has(key) && counts.size >= capacity)) return false;
    counts.set(key, count + 1);
    return true;
  };
}
