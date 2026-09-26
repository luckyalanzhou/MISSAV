import { getMissAVBaseURL, resolveMissAVURL } from "./domain"
import { cleanText, isCloudflareChallengeHTML as isCloudflareHTML, missavClient, parseMissAVVideoItems, type MissAVVideoItem } from "./client"
import { loadWebViewPage } from "./webview"

export type MissAVAccountState = "signedOut" | "signedIn" | "expired" | "blocked"
export type MissAVAccountSnapshot = { state: MissAVAccountState; domain: string; accountLabel?: string; accountEmail?: string; updatedAt?: number }
export type MissAVSavedVideosPage = { items: MissAVVideoItem[]; page: number; hasNext: boolean }
export type MissAVWebsiteSavedState = { saved: boolean; authenticated: boolean }

const ACCOUNT_KEY_PREFIX = "missav_account_cookie_v2_"
const ACCOUNT_META_PREFIX = "missav_account_meta_v2_"
const LOCALE = "ja"
const MISSAV_COOKIE_HOSTS = ["missav.ws", "missav.ai"] as const

function origin(): string { return new URL(getMissAVBaseURL()).origin }
function keySuffix(value = origin()): string { return value.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase() }
function cookieKey(value = origin()): string { return `${ACCOUNT_KEY_PREFIX}${keySuffix(value)}` }
function metaKey(value = origin()): string { return `${ACCOUNT_META_PREFIX}${keySuffix(value)}` }
function savedURL(page = 1): string { const url = new URL(`/${LOCALE}/saved`, `${origin()}/`); if (page > 1) url.searchParams.set("page", String(page)); return url.toString() }
function loginURL(): string { return new URL(`/${LOCALE}/login`, `${origin()}/`).toString() }
function loginAPIURL(): string { return new URL(`/${LOCALE}/api/login`, `${origin()}/`).toString() }

export function getMissAVAccountSnapshot(): MissAVAccountSnapshot {
  const domain = origin()
  const meta = parseMeta(Keychain.get(metaKey(domain)))
  const hasStoredSession = Boolean(Keychain.get(cookieKey(domain)))
  return { state: restoreMissAVAccountState(hasStoredSession, meta?.state), domain, accountLabel: meta?.accountLabel, accountEmail: meta?.accountEmail, updatedAt: meta?.updatedAt }
}

export function restoreMissAVAccountState(hasStoredSession: boolean, persistedState: unknown): MissAVAccountState {
  if (!hasStoredSession) return "signedOut"
  return persistedState === "expired" || persistedState === "blocked" ? persistedState : "signedIn"
}

export async function loginMissAV(email: string, password: string): Promise<MissAVAccountSnapshot> {
  const normalizedEmail = email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("请输入 MISSAV 注册邮箱，不能使用账号显示名。")
  if (!password) throw new Error("请输入 MISSAV 密码。")
  const controller = new WebViewController()
  try {
    await clearNonValidationMissAVCookies(controller)
    const initialPage = await loadWebViewPage(controller, loginURL())
    const initialHTML = initialPage.html
    if (!initialHTML || isCloudflareHTML(initialHTML)) throw new Error("当前线路暂时无法完成内置登录，请切换访问线路后重试。")
    if (!initialPage.loaded || !initialPage.finished) throw new Error("登录页面尚未加载完成，请稍后重试。")
    const result = await controller.evaluateJavaScript<{ ok: boolean; accountLabel?: string; status?: number; error?: string }>(`
      return (async () => {
        try {
          if (!window.axios) return { ok: false, error: "login_client_not_found" }
          const response = await window.axios.post(${JSON.stringify(loginAPIURL())}, {
            email: ${JSON.stringify(normalizedEmail)},
            password: ${JSON.stringify(password)},
            remember: true,
          })
          const user = response && response.data && response.data.user
          return { ok: Boolean(user), accountLabel: String((user && (user.email || user.username || user.name)) || ${JSON.stringify(normalizedEmail)}) }
        } catch (error) {
          const status = error && error.response && error.response.status
          const data = error && error.response && error.response.data
          const errors = data && data.errors
          const first = errors && Object.values(errors).flat().find(Boolean)
          return { ok: false, status, error: String(first || (data && data.message) || (error && error.message) || "login_failed") }
        }
      })()
    `)
    if (!result?.ok) {
      if (result?.status === 401 || result?.status === 422) throw new Error("邮箱或密码不正确，请检查后重试。")
      if (result?.error === "login_client_not_found") throw new Error("站点登录接口暂时不可用，请切换访问线路或稍后重试。")
      throw new Error(result?.error || "MISSAV 登录失败，请稍后重试。")
    }
    const verifiedPage = await loadWebViewPage(controller, savedURL())
    const verifiedHTML = verifiedPage.html
    if (!verifiedHTML || isCloudflareHTML(verifiedHTML)) throw new Error("登录请求已提交，但当前线路暂时无法验证会话，请切换访问线路后重试。")
    if (!verifiedPage.loaded || !verifiedPage.finished) throw new Error("登录请求已提交，但账号验证页面尚未加载完成，请稍后重试。")
    if (!isAuthenticatedHTML(verifiedHTML)) throw new Error("站点未建立有效登录会话，请检查注册邮箱和密码后重试。")
    const cookies = await controller.getCookies(savedURL())
    if (!cookies.length) throw new Error("登录成功，但未取得可用于站点收藏的会话，请稍后重试。")
    const verified: MissAVAccountSnapshot = { state: "signedIn", domain: origin(), accountLabel: extractAccountLabel(verifiedHTML) || result.accountLabel || normalizedEmail, accountEmail: normalizedEmail, updatedAt: Date.now() }
    saveSession(cookies, verified)
    return verified
  } finally { controller.dispose() }
}

export type MissAVSiteVerificationResult = "accessible" | "incomplete" | "unavailable"

export async function openMissAVSiteVerification(): Promise<MissAVSiteVerificationResult> {
  const controller = new WebViewController()
  try {
    // Probe the exact default Browse URL. The domain root may be accessible
    // while the listing route used by the app still requires a challenge.
    const probeURL = missavClient.browseProbeURL()
    // Always present the WebView, even when navigation reports failure. A
    // failed load can still leave a useful Cloudflare/error page to inspect.
    await loadWebViewPage(controller, probeURL)
    await controller.present({ fullscreen: true, navigationTitle: "验证访问线路" })
    const html = await controller.getHTML()
    if (isCloudflareHTML(html || "")) return "incomplete"
    return isLikelyMissAVPageHTML(html || "") ? "accessible" : "unavailable"
  } finally { controller.dispose() }
}

export function signOutMissAV(): void {
  Keychain.remove(cookieKey())
  Keychain.remove(metaKey())
}

export async function verifyMissAVAccount(): Promise<MissAVAccountSnapshot> {
  if (!readStoredCookies().length) return { state: "signedOut", domain: origin() }
  const result = await verifyStoredSession()
  const previous = getMissAVAccountSnapshot()
  const merged = { ...result, accountLabel: result.accountLabel || previous.accountLabel, accountEmail: previous.accountEmail }
  Keychain.set(metaKey(), JSON.stringify({ state: merged.state, accountLabel: merged.accountLabel, accountEmail: merged.accountEmail, updatedAt: Date.now() }), { accessibility: "first_unlock_this_device" })
  return merged
}

export async function getMissAVWebsiteSavedState(detailPath: string): Promise<MissAVWebsiteSavedState> {
  return websiteSavedTransaction(detailPath)
}

export async function setMissAVWebsiteSaved(detailPath: string, saved: boolean): Promise<MissAVWebsiteSavedState> {
  return websiteSavedTransaction(detailPath, saved)
}

export async function loadMissAVSavedVideos(page = 1): Promise<MissAVSavedVideosPage> {
  const cookies = readStoredCookies()
  if (!cookies.length) throw new Error("站点账号尚未登录。")
  const controller = new WebViewController()
  try {
    await restoreCookies(controller, cookies)
    const loadedPage = await loadWebViewPage(controller, savedURL(page))
    const html = loadedPage.html
    if (isCloudflareHTML(html)) throw new Error("当前线路暂时无法读取站点收藏，请切换访问线路后重试。")
    if (!loadedPage.loaded || !loadedPage.finished || !html) throw new Error("站点收藏页面尚未加载完成，请稍后重试。")
    if (!isAuthenticatedHTML(html)) throw new Error("站点账号已失效，请重新登录。")
    return { items: parseMissAVVideoItems(html), page, hasNext: hasNextPage(html, page) }
  } finally { controller.dispose() }
}

async function websiteSavedTransaction(detailPath: string, targetSaved?: boolean): Promise<MissAVWebsiteSavedState> {
  const cookies = readStoredCookies()
  if (!cookies.length) throw new Error("请先在设置中登录站点账号。")
  const controller = new WebViewController()
  try {
    await restoreCookies(controller, cookies)
    const loadedPage = await loadWebViewPage(controller, resolveMissAVURL(detailPath))
    const html = loadedPage.html
    if (isCloudflareHTML(html)) throw new Error("当前线路暂时无法读取站点收藏，请切换访问线路后重试。")
    if (!loadedPage.loaded || !loadedPage.finished || !html) throw new Error("网站详情页尚未加载完成，请稍后重试。")
    const target = targetSaved === undefined ? "null" : JSON.stringify(targetSaved)
    const result = await controller.evaluateJavaScript<{ ok: boolean; saved?: boolean; authenticated?: boolean; status?: number; error?: string }>(`
      return (async () => {
        const targetSaved = ${target}
        const root = [...document.querySelectorAll("[x-data]")].find(element => (element.getAttribute("x-data") || "").includes("toggleSave"))
        if (!root || !window.axios) return { ok: false, error: "save_component_not_found" }
        const source = root.getAttribute("x-data") || ""
        const initialization = root.getAttribute("x-init") || ""
        const pageSource = source + " " + initialization + " " + root.outerHTML + " " + document.documentElement.innerHTML
        const saveMatch = pageSource.match(/["']([^"']+\\/api\\/items\\/[^/"']+\\/save)["']/)
        const viewMatch = pageSource.match(/["']([^"']+\\/api\\/items\\/[^/"']+\\/view)["']/)
        if (!saveMatch || !viewMatch) return { ok: false, error: "save_endpoint_not_found" }
        const sameOrigin = raw => { const parsed = new URL(raw, location.href); return location.origin + parsed.pathname + parsed.search }
        const saveURL = sameOrigin(saveMatch[1])
        const viewURL = sameOrigin(viewMatch[1])
        try {
          const beforeResponse = await window.axios.get(viewURL)
          const before = Boolean(beforeResponse.data && beforeResponse.data.saved)
          const user = beforeResponse.data && beforeResponse.data.user
          const authenticated = user !== null && typeof user === "object"
          if (!authenticated) return { ok: false, authenticated: false, saved: before, status: 401, error: "unauthenticated" }
          if (targetSaved === null || before === targetSaved) return { ok: true, authenticated: true, saved: before }
          if (targetSaved) await window.axios.post(saveURL)
          else await window.axios.delete(saveURL)
          const afterResponse = await window.axios.get(viewURL)
          const after = Boolean(afterResponse.data && afterResponse.data.saved)
          return { ok: after === targetSaved, authenticated: true, saved: after, error: after === targetSaved ? undefined : "server_state_not_changed" }
        } catch (error) {
          const status = error && error.response && error.response.status
          return { ok: false, authenticated: status !== 401, status, error: status === 401 ? "unauthenticated" : String((error && error.response && error.response.data && error.response.data.message) || (error && error.message) || error) }
        }
      })()
    `)
    if (!result?.ok || typeof result.saved !== "boolean") {
      if (result?.status === 401 || result?.authenticated === false) throw new Error("站点账号已失效，请重新登录。")
      if (result?.error === "save_component_not_found" || result?.error === "save_endpoint_not_found") throw new Error("站点收藏接口已发生变化，请稍后更新脚本。")
      if (result?.error === "server_state_not_changed") throw new Error("网站没有确认本次收藏更改，请重试。")
      throw new Error(result?.error || "站点收藏操作失败。")
    }
    const finalURL = await controller.evaluateJavaScript<string>("return window.location.href")
    const refreshedCookies = await controller.getCookies(finalURL || resolveMissAVURL(detailPath))
    if (refreshedCookies.length) Keychain.set(cookieKey(), JSON.stringify(accountCookiesOnly(refreshedCookies)), { accessibility: "first_unlock_this_device" })
    return { saved: result.saved, authenticated: true }
  } finally { controller.dispose() }
}

async function verifyStoredSession(): Promise<MissAVAccountSnapshot> {
  try {
    const controller = new WebViewController()
    try {
      await restoreCookies(controller, readStoredCookies())
      const loadedPage = await loadWebViewPage(controller, savedURL())
      const html = loadedPage.html
      if (!loadedPage.loaded || !loadedPage.finished || !html || isCloudflareHTML(html)) return { state: "blocked", domain: origin() }
      if (!isAuthenticatedHTML(html)) return { state: "expired", domain: origin() }
      return { state: "signedIn", domain: origin(), accountLabel: extractAccountLabel(html), updatedAt: Date.now() }
    } finally { controller.dispose() }
  } catch { return { state: "blocked", domain: origin() } }
}

function saveSession(cookies: any[], snapshot: MissAVAccountSnapshot): void {
  Keychain.set(cookieKey(), JSON.stringify(accountCookiesOnly(cookies)), { accessibility: "first_unlock_this_device" })
  Keychain.set(metaKey(), JSON.stringify({ state: "signedIn", accountLabel: snapshot.accountLabel, accountEmail: snapshot.accountEmail, updatedAt: snapshot.updatedAt }), { accessibility: "first_unlock_this_device" })
}
function isSiteValidationCookie(cookie: any): boolean {
  const name = String(cookie?.name || "").toLowerCase()
  return name.startsWith("cf_") || name.startsWith("__cf")
}
function accountCookiesOnly(cookies: any[]): any[] { return cookies.filter(cookie => cookie?.name && cookie?.value && cookie?.domain && !isSiteValidationCookie(cookie)) }
function readStoredCookies(): any[] { try { const value = Keychain.get(cookieKey()); const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? accountCookiesOnly(parsed) : [] } catch { return [] } }
function isMissAVCookie(cookie: any): boolean {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase()
  return MISSAV_COOKIE_HOSTS.some(host => domain === host || domain.endsWith(`.${host}`))
}
async function clearNonValidationMissAVCookies(controller: WebViewController): Promise<void> {
  const cookies = await controller.getAllCookies()
  for (const cookie of cookies) if (isMissAVCookie(cookie) && !isSiteValidationCookie(cookie)) await controller.deleteCookie(cookie)
}
async function setStoredCookie(controller: WebViewController, stored: any): Promise<void> {
  if (!stored?.name || !stored?.value || !stored?.domain) return
  const cookie = { ...stored, expiresDate: stored.expiresDate ? new Date(stored.expiresDate) : undefined }
  await controller.setCookie(cookie)
}
async function restoreCookies(controller: WebViewController, cookies: any[]): Promise<void> {
  await clearNonValidationMissAVCookies(controller)
  for (const stored of accountCookiesOnly(cookies)) await setStoredCookie(controller, stored)
}
function isAuthenticatedHTML(html: string): boolean {
  const positive = /マイアカウント|(?:logout|登出|ログアウト|sign[\s-]?out|用户菜单|ユーザー)/i.test(html)
  const savedContent = /私のビデオコレクション/i.test(html) && /(?:thumbnail|video|duration|movies|grid)/i.test(html)
  return positive || savedContent
}
function extractAccountLabel(html: string): string | undefined { return cleanText(firstMatch(html, /(?:data-user-name|data-username)=['"]([^'"]+)/i)) || cleanText(firstMatch(html, /<meta\b[^>]*name=['"]user['"][^>]*content=['"]([^'"]+)/i)) || undefined }
function isLikelyMissAVPageHTML(html: string): boolean { return Boolean(html && /missav/i.test(html) && /<(?:html|body|main|video|meta)\b/i.test(html) && html.length > 500) }
function hasNextPage(html: string, page: number): boolean { return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some(match => { try { return Number(new URL(match[1], `${origin()}/`).searchParams.get("page")) === page + 1 } catch { return false } }) }
function parseMeta(value: string | null): { state?: MissAVAccountState; accountLabel?: string; accountEmail?: string; updatedAt?: number } | null { try { return value ? JSON.parse(value) : null } catch { return null } }
function firstMatch(value: string, regex: RegExp): string { return regex.exec(value)?.[1] || "" }
