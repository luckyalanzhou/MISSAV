import { MISSAV_DOMAIN_OPTIONS } from "./domain"
import type { MissAVSearchPage, MissAVVideoItem, MissAVCategoryItem } from "./client"

export const LISTING_CACHE_FRESH_MS = 45_000
export const LISTING_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export type CachedListing = { savedAt: number; value: MissAVSearchPage }
type CacheBackend = { read(key: string): Promise<unknown>; write(key: string, record: CachedListing): Promise<void> }
let backend: CacheBackend | undefined

// Installed by the script entry point. Pure client tests and hosts without a
// working database can load pages without eagerly touching native SQLite.
export function installMissAVListingCache(value: CacheBackend): void { backend = value }

export function listingCacheKey(target: string): string {
  const url = new URL(target)
  if (!MISSAV_DOMAIN_OPTIONS.some(option => new URL(option.value).origin === url.origin)
    || url.username || url.password || !/^\/(?:dm\d+\/)?cn(?:\/|$)/.test(url.pathname)) throw new Error("Invalid listing cache scope")
  url.pathname = url.pathname.replace(/^\/dm\d+(?=\/)/, "").replace(/\/+$/, "") || "/cn"
  url.hash = ""; url.searchParams.sort()
  return url.toString()
}

function validPage(value: any, key: string): MissAVSearchPage | null {
  if (!value || !Array.isArray(value.items) || value.items.length > 2000 || typeof value.title !== "string" || value.title.length > 3000
    || !Number.isInteger(value.page) || value.page < 1 || typeof value.hasNext !== "boolean"
    || value.page !== Number(new URL(key).searchParams.get("page") || 1)) return null
  const origin = new URL(key).origin
  const urlField = (path: unknown, detail = false) => {
    if (typeof path !== "string" || path.length > 4000) return false
    if (!path && !detail) return true
    try { const url = new URL(path, key); return /^https?:$/.test(url.protocol) && !url.username && !url.password && (!detail || url.origin === origin && /^\/(?:dm\d+\/)?cn\//.test(url.pathname)) } catch { return false }
  }
  const items: MissAVVideoItem[] = []
  for (const item of value.items) {
    if (!item || typeof item.videoCode !== "string" || !item.videoCode || item.videoCode.length > 200 || typeof item.title !== "string" || item.title.length > 3000
      || !urlField(item.detailPath, true) || !urlField(item.coverUrl) || [item.duration, item.badge].some(value => value !== undefined && typeof value !== "string")) return null
    items.push({ videoCode: item.videoCode, title: item.title, detailPath: item.detailPath, coverUrl: item.coverUrl, duration: item.duration, badge: item.badge })
  }
  let categories: MissAVCategoryItem[] | undefined
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories) || value.categories.length > 2000) return null
    categories = []
    for (const item of value.categories) {
      if (!item || typeof item.title !== "string" || item.title.length > 3000 || !urlField(item.path, true) || item.coverUrl !== undefined && !urlField(item.coverUrl)) return null
      categories.push({ title: item.title, path: item.path, coverUrl: item.coverUrl })
    }
  }
  if (!items.length && !categories?.length) return null
  return { items, categories, title: value.title, page: value.page, hasNext: value.hasNext }
}

export async function readCachedListing(target: string): Promise<CachedListing | null> {
  if (!backend) return null
  try {
    const key = listingCacheKey(target)
    const raw: any = await backend.read(key)
    if (!raw || !Number.isFinite(raw.savedAt) || raw.savedAt <= 0 || raw.savedAt > Date.now() + 5000 || Date.now() - raw.savedAt > LISTING_CACHE_MAX_AGE_MS) return null
    const value = validPage(raw.value, key)
    return value ? { savedAt: raw.savedAt, value } : null
  } catch { return null } // Cache errors never break online content.
}

export async function writeCachedListing(target: string, value: MissAVSearchPage, savedAt: number): Promise<void> {
  if (!backend || value.stale) return
  try {
    const key = listingCacheKey(target), clean = validPage(value, key)
    if (clean) await backend.write(key, { savedAt, value: clean })
  } catch { /* Persistence is optional and must not replace a successful page with an error. */ }
}
