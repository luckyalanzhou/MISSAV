import { MISSAV_DOMAIN_OPTIONS } from "../domain"
import { withMissAVDeadline } from "../../core/request/request-deadline"
import type { MissAVSearchPage, MissAVVideoItem, MissAVCategoryItem } from "../client"

export const LISTING_CACHE_FRESH_MS = 45_000
export const LISTING_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export type CachedListing = { savedAt: number; value: MissAVSearchPage }
type CacheBackend = { read(key: string): Promise<unknown>; write(key: string, record: CachedListing): Promise<void> }
let backend: CacheBackend | undefined

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

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

function validPage(value: unknown, key: string): MissAVSearchPage | null {
  if (!isRecord(value) || !isUnknownArray(value.items) || value.items.length > 2000 || typeof value.title !== "string" || value.title.length > 3000
    || typeof value.page !== "number" || !Number.isInteger(value.page) || value.page < 1 || typeof value.hasNext !== "boolean"
    || value.page !== Number(new URL(key).searchParams.get("page") || 1)) return null
  const origin = new URL(key).origin
  const urlField = (path: unknown, detail = false): path is string => {
    if (typeof path !== "string" || path.length > 4000) return false
    if (!path && !detail) return true
    try { const url = new URL(path, key); return /^https?:$/.test(url.protocol) && !url.username && !url.password && (!detail || url.origin === origin && /^\/(?:dm\d+\/)?cn\//.test(url.pathname)) } catch { return false }
  }
  const items: MissAVVideoItem[] = []
  for (const candidate of value.items) {
    if (!isRecord(candidate)) return null
    const videoCode = candidate.videoCode
    const title = candidate.title
    const detailPath = candidate.detailPath
    const coverUrl = candidate.coverUrl
    const duration = candidate.duration
    const badge = candidate.badge
    if (typeof videoCode !== "string" || !videoCode || videoCode.length > 200 || typeof title !== "string" || title.length > 3000
      || !urlField(detailPath, true) || !urlField(coverUrl) || (duration !== undefined && typeof duration !== "string") || (badge !== undefined && typeof badge !== "string")) return null
    items.push({ videoCode, title, detailPath, coverUrl, duration, badge })
  }
  let categories: MissAVCategoryItem[] | undefined
  if (value.categories !== undefined) {
    if (!isUnknownArray(value.categories) || value.categories.length > 2000) return null
    categories = []
    for (const candidate of value.categories) {
      if (!isRecord(candidate)) return null
      const title = candidate.title
      const path = candidate.path
      const coverUrl = candidate.coverUrl
      if (typeof title !== "string" || title.length > 3000 || !urlField(path, true) || (coverUrl !== undefined && !urlField(coverUrl))) return null
      categories.push({ title, path, coverUrl })
    }
  }
  if (!items.length && !categories?.length) return null
  return { items, categories, title: value.title, page: value.page, hasNext: value.hasNext }
}

export async function readCachedListing(target: string): Promise<CachedListing | null> {
  if (!backend) return null
  try {
    const key = listingCacheKey(target)
    const raw: unknown = await withMissAVDeadline(backend.read(key), 1_000, "读取栏目缓存超时。")
    if (!isRecord(raw) || typeof raw.savedAt !== "number" || !Number.isFinite(raw.savedAt) || raw.savedAt <= 0 || raw.savedAt > Date.now() + 5000 || Date.now() - raw.savedAt > LISTING_CACHE_MAX_AGE_MS) return null
    const value = validPage(raw.value, key)
    return value ? { savedAt: raw.savedAt, value } : null
  } catch { return null } // Cache errors never break online content.
}

export async function writeCachedListing(target: string, value: MissAVSearchPage, savedAt: number): Promise<void> {
  if (!backend || value.stale) return
  try {
    const key = listingCacheKey(target), clean = validPage(value, key)
    if (clean) await withMissAVDeadline(backend.write(key, { savedAt, value: clean }), 1_000, "保存栏目缓存超时。")
  } catch { /* Persistence is optional and must not replace a successful page with an error. */ }
}
