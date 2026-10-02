import { MISSAV_DOMAIN_OPTIONS } from "./domain"
import type { MissAVRequestScope } from "./request-scope"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"

const CLOUDFLARE_COOKIE_KEY_PREFIX = "missav_cloudflare_cookie_v1_"
const MISSAV_HOSTS = MISSAV_DOMAIN_OPTIONS.map(option => new URL(option.value).hostname.toLowerCase())
const COOKIE_OPERATION_TIMEOUT_MS = 2_000
const restoreQueues = new Map<string, Promise<unknown>>()
const RECENT_NATIVE_SESSION_MS = 15_000
const recentNativeSessions = new Map<string, { observedAt: number; path: string; expiryMs: number | null; result: CloudflareRestoreResult }>()

export type CloudflareRestoreResult = {
  state: "live" | "recent" | "restored" | "missing" | "invalid" | "expired" | "scope-mismatch" | "rejected" | "unconfirmed" | "store-unavailable" | "unsupported";
  attempted: number; accepted: number; confirmed: number; clearance: boolean; expiresInSeconds: number | null;
}
class CookieOperationTimeout extends Error {}

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
    && typeof cookie.domain === "string" && isMissAVHost(normalizeHost(cookie.domain)) && cookieMatchesHost(cookie.domain, normalizedHost)
    && (cookie.path === undefined || typeof cookie.path === "string" && cookie.path.startsWith("/"))
    && !isCookieExpired(cookie))
}

export async function captureCloudflareSession(controller: WebViewController, host: string, scope?: MissAVRequestScope): Promise<number> {
  scope?.assertActive()
  const target = sessionTarget(host)
  if (!target) return 0
  const cookies = cloudflareCookiesForHost(await cookieOperation(() => controller.getAllCookies(), scope), target.hostname)
  scope?.assertActive()
  if (!cookies.some(isClearance)) return 0
  rememberNativeSession(target.hostname, cookies, { state: "live", attempted: 0, accepted: 0, confirmed: cookies.length, clearance: true, expiresInSeconds: null })
  Keychain.set(cookieKey(target.hostname), JSON.stringify(cookies), { accessibility: "first_unlock_this_device" })
  recordMissAVAccessDiagnostic("cookie-capture", target.toString(), { state: "saved", confirmed: cookies.length, clearance: true })
  return cookies.length
}

// Compatibility count is now read-back-confirmed, never the backup size.
export async function restoreCloudflareSession(controller: WebViewController, target: string, scope?: MissAVRequestScope): Promise<number> {
  const result = await restoreCloudflareSessionDetailed(controller, target, scope)
  return result.clearance ? result.confirmed : 0
}

export async function restoreCloudflareSessionDetailed(controller: WebViewController, value: string, scope?: MissAVRequestScope, options: { allowRecent?: boolean } = {}): Promise<CloudflareRestoreResult> {
  scope?.assertActive()
  const target = sessionTarget(value)
  if (!target) return { state: "unsupported", attempted: 0, accepted: 0, confirmed: 0, clearance: false, expiresInSeconds: null }
  // Only callers using the default shared WebKit store may opt in. This is
  // recent native-cookie evidence, never proof that this page passed a challenge.
  const recent = options.allowRecent ? readRecentNativeSession(target) : null
  if (recent && !restoreQueues.has(target.hostname)) {
    recordMissAVAccessDiagnostic("cookie-restore", target.toString(), { ...recent, elapsedMs: 0 })
    return recent
  }
  // Concurrent WebViews share a store. Queue restoration per host, then check
  // the live jar again, rather than overwriting one another with old snapshots.
  const previous = restoreQueues.get(target.hostname) || Promise.resolve()
  const request = previous.catch(() => {}).then(() => restoreSession(controller, target, scope))
  restoreQueues.set(target.hostname, request)
  void request.then(() => { if (restoreQueues.get(target.hostname) === request) restoreQueues.delete(target.hostname) },
    () => { if (restoreQueues.get(target.hostname) === request) restoreQueues.delete(target.hostname) })
  return scope ? scope.waitFor(request) : request
}

export function invalidateRecentCloudflareSession(value: string): void {
  const target = sessionTarget(value)
  if (target) recentNativeSessions.delete(target.hostname)
}

function rememberNativeSession(host: string, cookies: StoredCloudflareCookie[], result: CloudflareRestoreResult): void {
  const clearance = cookies.find(isClearance)
  if (!clearance || !result.clearance) { recentNativeSessions.delete(host); return }
  recentNativeSessions.set(host, { observedAt: Date.now(), path: typeof clearance.path === "string" ? clearance.path : "/", expiryMs: toExpiryDate(clearance.expiresDate)?.getTime() ?? null, result: { ...result } })
}

function readRecentNativeSession(target: URL): CloudflareRestoreResult | null {
  const recent = recentNativeSessions.get(target.hostname)
  if (!recent) return null
  const age = Date.now() - recent.observedAt
  if (age < 0 || age >= RECENT_NATIVE_SESSION_MS || recent.expiryMs !== null && recent.expiryMs <= Date.now()) { recentNativeSessions.delete(target.hostname); return null }
  if (target.pathname !== recent.path && !(target.pathname.startsWith(recent.path) && (recent.path.endsWith("/") || target.pathname[recent.path.length] === "/"))) return null
  return { ...recent.result, state: "recent", attempted: 0, accepted: 0, expiresInSeconds: recent.expiryMs === null ? null : Math.max(0, Math.floor((recent.expiryMs - Date.now()) / 1000)) }
}

async function restoreSession(controller: WebViewController, target: URL, scope?: MissAVRequestScope): Promise<CloudflareRestoreResult> {
  const started = Date.now()
  const result: CloudflareRestoreResult = { state: "missing", attempted: 0, accepted: 0, confirmed: 0, clearance: false, expiresInSeconds: null }
  const finish = (state: CloudflareRestoreResult["state"], cookies: StoredCloudflareCookie[] = []) => {
    scope?.assertActive()
    result.state = state
    result.confirmed = cookies.length
    const clearance = cookies.find(isClearance)
    result.clearance = Boolean(clearance)
    const expiry = toExpiryDate(clearance?.expiresDate)
    result.expiresInSeconds = expiry ? Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 1000)) : null
    rememberNativeSession(target.hostname, cookies, result)
    recordMissAVAccessDiagnostic("cookie-restore", target.toString(), { ...result, elapsedMs: Date.now() - started })
    return result
  }
  scope?.assertActive()
  let nativeUnavailable = false
  try {
    const liveCookies = await applicableCookies(controller, target, scope)
    scope?.assertActive()
    // Default WebViews share a persistent cookie store. Do not replace a
    // newly verified clearance with an older Keychain snapshot.
    if (liveCookies.some(isClearance)) return finish("live", liveCookies)
  } catch { nativeUnavailable = true /* Restore from backup if the native store cannot be read. */ }
  scope?.assertActive()
  const backup = readCloudflareSession(target.hostname)
  if (!backup.cookies.length) return finish(backup.state === "missing" && nativeUnavailable ? "store-unavailable" : backup.state)
  const cookies = backup.cookies.filter(cookie => cookieMatchesURL(cookie, target))
  if (!cookies.some(isClearance)) return finish("scope-mismatch")
  const accepted: StoredCloudflareCookie[] = []
  // A clearance cookie is attempted before auxiliary cookies. An unknown
  // timeout is not retried: the native write may still complete later.
  cookies.sort((a, b) => Number(isClearance(b)) - Number(isClearance(a)))
  for (const stored of cookies) {
    scope?.assertActive()
    result.attempted++
    try {
      const cookie = { ...stored, expiresDate: toExpiryDate(stored.expiresDate) } as Parameters<WebViewController["setCookie"]>[0]
      if (await cookieOperation(() => controller.setCookie(cookie), scope) === true) {
        result.accepted++
        accepted.push(stored)
      }
    } catch (error) {
      scope?.assertActive()
      if (error instanceof CookieOperationTimeout) return finish("unconfirmed")
      // A stale or unsupported auxiliary Cloudflare cookie must not prevent page loading.
    }
    scope?.assertActive()
  }
  try {
    const readback = await applicableCookies(controller, target, scope)
    scope?.assertActive()
    if (readback.some(isClearance)) {
      const restored = readback.some(cookie => isClearance(cookie) && accepted.some(saved => sameCookie(saved, cookie)))
      return finish(restored ? "restored" : "live", readback)
    }
    return finish(result.accepted ? "unconfirmed" : "rejected", readback)
  } catch {
    scope?.assertActive()
    return finish(result.accepted ? "unconfirmed" : "store-unavailable")
  }
}

function readCloudflareSession(host: string): { cookies: StoredCloudflareCookie[]; state: "missing" | "invalid" | "expired" | "store-unavailable" } {
  const key = cookieKey(host)
  let value: string | null | undefined
  try {
    value = Keychain.get(key)
    if (!value) return { cookies: [], state: "missing" }
  } catch { return { cookies: [], state: "store-unavailable" } }
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { discardSnapshot(key, value); return { cookies: [], state: "invalid" } }
  const cookies = Array.isArray(parsed) ? cloudflareCookiesForHost(parsed, host) : []
  if (cookies.some(isClearance)) return { cookies, state: "missing" }
  const expired = Array.isArray(parsed) && parsed.some(cookie => isCloudflareSessionCookie(cookie) && isClearance(cookie) && isCookieExpired(cookie))
  discardSnapshot(key, value)
  return { cookies: [], state: expired ? "expired" : "invalid" }
}

function discardSnapshot(key: string, value: string): void {
  // Remove only the unchanged Cloudflare backup, never native/account cookies.
  try { if (Keychain.get(key) === value) Keychain.remove(key) } catch { /* Keychain cleanup is best-effort. */ }
}

async function applicableCookies(controller: WebViewController, target: URL, scope?: MissAVRequestScope): Promise<StoredCloudflareCookie[]> {
  const cookies = await cookieOperation(() => typeof controller.getCookies === "function" ? controller.getCookies(target.toString()) : controller.getAllCookies(), scope)
  return cloudflareCookiesForHost(cookies, target.hostname).filter(cookie => cookieMatchesURL(cookie, target))
}

async function cookieOperation<T>(operation: () => Promise<T>, scope?: MissAVRequestScope): Promise<T> {
  scope?.assertActive()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const request = Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CookieOperationTimeout()), COOKIE_OPERATION_TIMEOUT_MS)
    })])
    const result = await (scope ? scope.waitFor(request) : request)
    scope?.assertActive()
    return result
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

function sessionTarget(value: string): URL | null {
  try {
    const target = new URL(value.includes("://") ? value : `https://${normalizeHost(value)}/`)
    return target.protocol === "https:" && !target.username && !target.password && isMissAVHost(target.hostname) ? target : null
  } catch { return null }
}

function isClearance(cookie: NamedCookieRecord): boolean { return cookie.name.toLowerCase() === "cf_clearance" }
function sameCookie(a: StoredCloudflareCookie, b: StoredCloudflareCookie): boolean {
  return a.name === b.name && a.value === b.value && normalizeHost(a.domain) === normalizeHost(b.domain) && (a.path || "/") === (b.path || "/")
}
function cookieMatchesURL(cookie: StoredCloudflareCookie, target: URL): boolean {
  const path = typeof cookie.path === "string" ? cookie.path : "/"
  const coversPath = target.pathname === path || target.pathname.startsWith(path) && (path.endsWith("/") || target.pathname[path.length] === "/")
  const domain = normalizeHost(cookie.domain)
  const coversHost = domain === target.hostname || cookie.domain.startsWith(".") && target.hostname.endsWith(`.${domain}`)
  return coversPath && coversHost && (!cookie.isSecure || target.protocol === "https:")
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
