import type { MediaT } from "./types";

/** Media is served through the API proxy (the bucket is private). `v` busts the cache when a drawing is re-saved. */
export const mediaUrl = (m: MediaT, name: string) => `/api/v1/media/${m.key}/${name}?v=${m.v}`;

export function srcSet(m: MediaT, fmt: "webp" | "avif") {
  return m.variants[fmt].map((w) => `${mediaUrl(m, `${w}.${fmt}`)} ${w}w`).join(", ");
}

export function largest(m: MediaT, max = 2048) {
  const ws = m.variants.webp.filter((w) => w <= max);
  const w = ws.length ? Math.max(...ws) : Math.min(...m.variants.webp);
  return mediaUrl(m, `${w}.webp`);
}

export function smallest(m: MediaT) {
  return mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`);
}
