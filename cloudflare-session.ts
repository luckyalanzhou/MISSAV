import { MISSAV_DOMAIN_OPTIONS } from "./domain"
import type { MissAVRequestScope } from "./request-scope"

const CLOUDFLARE_COOKIE_KEY_PREFIX = "missav_cloudflare_cookie_v1_"
const MISSAV_HOSTS = MISSAV_DOMAIN_OPTIONS.map(option => new URL(option.value).hostname.toLowerCase())

type CookieRecord = Record<string, unknown> & {
  name?: unknown
  value?: unknown
  domain?: unknown
  expiresDate?: unknown
}

type NamedCookieRecord = CookieRecord & { name: string }
type StoredCloudflareCookie = CookieRecord & { name: string; value: string; domain: string }

export function isCloudflareSessionCookie(cookie: unknown): cookie is NamedCookieRecord {
  return isCookieRecord(cookie)
    && typeof cookie.name === "string"
    && /^(?:cf_|__cf|_cf)/i.test(cookie.name)
}

export function cloudflareCookiesForHost(cookies: readonly unknown[], host: string): StoredCloudflareCookie[] {
  const normalizedHost = normalizeHost(host)
  if (!isMissAVHost(normalizedHost)) return []
  return cookies.filter((cookie): cookie is StoredCloudflareCookie => isCloudflareSessionCookie(cookie)
    && typeof cookie.value === "string" && Boolean(cookie.value)
    && typeof cookie.domain === "string" && cookieMatchesHost(cookie.domain, normalizedHost)
    && !isCookieExpired(cookie))
}

export async function captureCloudflareSession(controller: WebViewController, host: string, scope?: MissAVRequestScope): Promise<number> {
  scope?.assertActive()
  const cookies = cloudflareCookiesForHost(await controller.getAllCookies(), host)
  scope?.assertActive()
  if (!cookies.some(cookie => cookie.name.toLowerCase() === "cf_clearance")) return 0
  Keychain.set(cookieKey(host), JSON.stringify(cookies), { accessibility: "first_unlock_this_device" })
  return cookies.length
}

export async function restoreCloudflareSession(controller: WebViewController, host: string, scope?: MissAVRequestScope): Promise<number> {
  scope?.assertActive()
  try {
    const liveCookies = cloudflareCookiesForHost(await controller.getAllCookies(), host)
    scope?.assertActive()
    // Default WebViews share a persistent cookie store. Do not replace a
    // newly verified clearance with an older Keychain snapshot.
    if (liveCookies.some(cookie => cookie.name.toLowerCase() === "cf_clearance")) return liveCookies.length
  } catch { /* Restore the saved session if the native cookie store is unavailable. */ }
  scope?.assertActive()
  const cookies = readCloudflareSession(host)
  for (const stored of cookies) {
    scope?.assertActive()
    try {
      const cookie = { ...stored, expiresDate: toExpiryDate(stored.expiresDate) } as Parameters<WebViewController["setCookie"]>[0]
      await controller.setCookie(cookie)
    } catch {
      // A stale or unsupported auxiliary Cloudflare cookie must not prevent page loading.
    }
    scope?.assertActive()
  }
  return cookies.length
}

function readCloudflareSession(host: string): StoredCloudflareCookie[] {
  if (!isMissAVHost(normalizeHost(host))) return []
  try {
    const value = Keychain.get(cookieKey(host))
    const parsed: unknown = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? cloudflareCookiesForHost(parsed, host) : []
  } catch { return [] }
}

function cookieKey(host: string): string {
  return `${CLOUDFLARE_COOKIE_KEY_PREFIX}${normalizeHost(host).replace(/[^a-z0-9]+/g, "_")}`
}

function cookieMatchesHost(cookieDomain: string, host: string): boolean {
  const domain = normalizeHost(cookieDomain)
  return domain === host || host.endsWith(`.${domain}`)
}

function isMissAVHost(host: string): boolean {
  return MISSAV_HOSTS.some(siteHost => host === siteHost || host.endsWith(`.${siteHost}`))
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\.+/, "").toLowerCase()
}

function isCookieExpired(cookie: CookieRecord): boolean {
  if (cookie.expiresDate === undefined || cookie.expiresDate === null || cookie.expiresDate === "") return false
  const expiry = toExpiryDate(cookie.expiresDate)
  return !expiry || expiry.getTime() <= Date.now()
}

function toExpiryDate(value: unknown): Date | undefined {
  const expiry = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number" ? new Date(value) : undefined
  return expiry && Number.isFinite(expiry.getTime()) ? expiry : undefined
}

function isCookieRecord(value: unknown): value is CookieRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
