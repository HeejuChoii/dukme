/**
 * Read-only image previews from the owner's public 손민수위키 / reCree detail pages.
 * Never guesses an image based on a product name or substitutes a different item's photo.
 * A missing/blocked page simply produces null, and the UI keeps its current icon.
 */
import type { Item, Place } from './data.js';

export type MediaPreview = { imageUrl: string; kind: 'photo' | 'share_preview'; source: 'sonminsoo' | 'recree' } | null;
const cache = new Map<string, { until: number; pending: Promise<MediaPreview> }>();
const CACHE_MS = 30 * 60 * 1000;
const ALLOWED_PAGE_HOSTS = new Set(['sonminsoo.kr', 'www.sonminsoo.kr', 'recree.io', 'www.recree.io']);
// Hand-verified public images from the same reCree pages for the NCT WISH Mokpo demo.
// These display immediately even if metadata extraction is temporarily blocked.
const FEATURED_RECREe_PHOTOS: Record<string, string> = {
  'place_165': 'https://cdn.recree.io/post-images/banner/ebce25b8-02f4-40bd-9167-6972058028f7/1791820822156-hct58q0crhg.png',
  'place_344': 'https://cdn.recree.io/post-images/banner/new/1789972490791-j7yrbdsbu5.png',
  'place_161': 'https://cdn.recree.io/post-images/banner/a8aeee92-fc06-43e6-9102-1a22214d1fa9/1791821548780-c2iqbacpqjf.png',
};


function pageUrl(input: string | null | undefined, host: 'sonminsoo.kr' | 'recree.io'): URL | null {
  if (!input) return null;
  try {
    const u = new URL(input);
    return u.protocol === 'https:' && (u.hostname === host || u.hostname === `www.${host}`) ? u : null;
  } catch { return null; }
}

export function safeImageUrl(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const decoded = value.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"');
  try {
    const u = new URL(decoded.trim(), base);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || u.href.length > 3500) return null;
    if (/\.(svg)(?:\?|$)/i.test(u.pathname) || /(?:logo|favicon|avatar|placeholder)/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? "").replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
}
function meta(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() === property.toLowerCase()) return attr(tag, 'content');
  }
  return null;
}
function selectLdPhoto(doc: unknown): string | null {
  if (Array.isArray(doc)) {
    for (const part of doc) { const found = selectLdPhoto(part); if (found) return found; }
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const r = doc as Record<string, unknown>;
  if (r['@graph']) return selectLdPhoto(r['@graph']);
  const types = Array.isArray(r['@type']) ? r['@type'] : [r['@type']];
  if (!types.some(t => t === 'Product' || t === 'Place')) return null;
  const raw = r.image;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.find(x => typeof x === 'string') ?? null;
  if (raw && typeof raw === 'object') return String((raw as Record<string, unknown>).url ?? '');
  return null;
}

/** Extract product photo first, social share preview only if actual item photo is missing. */
export function extractWikiPreview(html: string, base: string): MediaPreview {
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const candidate = safeImageUrl(selectLdPhoto(JSON.parse(script[1] ?? "null")), base);
      if (candidate) return { imageUrl: candidate, kind: 'photo', source: 'sonminsoo' };
    } catch { /* other structured data is allowed to be malformed */ }
  }
  // The second <figure> of .item-photos is the product image; the first is idol reference photo.
  const photos = html.match(/<section\b[^>]*aria-label=["']사진["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  if (photos) {
    const figures = [...photos.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)];
    if (figures.length > 1) {
      const img = (figures[1]?.[1] ?? "").match(/<img\b[^>]*>/i)?.[0];
      const candidate = img ? safeImageUrl(attr(img, 'src'), base) : null;
      if (candidate) return { imageUrl: candidate, kind: 'photo', source: 'sonminsoo' };
    }
  }
  const og = safeImageUrl(meta(html, 'og:image'), base);
  return og ? { imageUrl: og, kind: 'share_preview', source: 'sonminsoo' } : null;
}

/** reCree banners are real source-linked place imagery, not arbitrary search results. */
export function extractRecreePreview(html: string, base: string): MediaPreview {
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const raw = attr(tag, 'src') ?? attr(tag, 'data-src');
    const candidate = safeImageUrl(raw, base);
    if (candidate && candidate.includes('cdn.recree.io/post-images/')) return { imageUrl: candidate, kind: 'photo', source: 'recree' };
  }
  const og = safeImageUrl(meta(html, 'og:image'), base);
  return og ? { imageUrl: og, kind: 'share_preview', source: 'recree' } : null;
}

async function fetchTrustedHtml(start: URL): Promise<string | null> {
  let url = start;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!ALLOWED_PAGE_HOSTS.has(url.hostname) || url.protocol !== 'https:') return null;
    try {
      const response = await fetch(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(6000),
        headers: { 'accept': 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; DukmePhotoPreview/1.0)' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location');
        if (!target) return null;
        url = new URL(target, url);
        continue;
      }
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) return null;
      // Only need initial HTML. Max 5 MB, no unbounded remote fetch.
      const limit = 5_000_000;
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const reader = response.body?.getReader();
      if (!reader) return null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > limit) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      return new TextDecoder().decode(Buffer.concat(chunks));
    } catch { return null; }
  }
  return null;
}

async function resolvePreview(kind: 'item' | 'place', id: string, source: Item | Place): Promise<MediaPreview> {
  if (kind === 'item') {
    const item = source as Item;
    const direct = safeImageUrl(item.imageUrl, 'https://sonminsoo.kr');
    if (direct) return { imageUrl: direct, kind: 'photo', source: 'sonminsoo' };
    const url = pageUrl(item.wikiUrl, 'sonminsoo.kr');
    if (!url) return null; // X-only rows have no image; never substitute other idols.
    const html = await fetchTrustedHtml(url);
    return html ? extractWikiPreview(html, url.href) : null;
  }
  const place = source as Place;
  const direct = safeImageUrl(place.imageUrl ?? FEATURED_RECREe_PHOTOS[id], 'https://recree.io');
  if (direct) return { imageUrl: direct, kind: 'photo', source: 'recree' };
  const url = pageUrl(place.recreeUrl, 'recree.io');
  if (!url) return null;
  const html = await fetchTrustedHtml(url);
  return html ? extractRecreePreview(html, url.href) : null;
}

export function getMediaPreview(kind: 'item' | 'place', id: string, source: Item | Place): Promise<MediaPreview> {
  const key = `${kind}:${id}`;
  const existing = cache.get(key);
  if (existing && existing.until > Date.now()) return existing.pending;
  const pending = resolvePreview(kind, id, source).catch(() => null);
  cache.set(key, { until: Date.now() + CACHE_MS, pending });
  return pending;
}
