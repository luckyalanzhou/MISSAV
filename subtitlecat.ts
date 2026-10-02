import { fetch } from "scripting"
import { loadWebViewPage } from "./webview"

const SUBTITLECAT_ORIGIN = "https://www.subtitlecat.com"
const SUBTITLECAT_HOME = `${SUBTITLECAT_ORIGIN}/`
const SUBTITLECAT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const SUBTITLECAT_CACHE_KEY = "missav_subtitlecat_search_cache_v1"
const SUBTITLECAT_CACHE_TTL_MS = 30 * 60 * 1000
const SUBTITLECAT_CACHE_MAX_CODES = 50
const SUBTITLECAT_CACHE_MAX_CHARACTERS = 2_000_000

export type SubtitleCatSubtitleFile = {
  id: string
  source: "SubtitleCat"
  language: string
  details: string
  downloadURL: string
  isFree: true
  isDemo: false
}

export type SubtitleCatSearchResult = {
  files: SubtitleCatSubtitleFile[]
  searchResultCount: number
  failedDetailCount: number
  processedDetailCount: number
  metrics: SubtitleCatSearchMetrics
}

export type SubtitleCatSearchMetrics = {
  elapsedMs: number
  firstResultMs: number | null
  httpRequests: number
  webViewLoads: number
  searchCacheHits: number
  detailCacheHits: number
}

export type SubtitleCatSearchOptions = {
  onProgress?: (result: SubtitleCatSearchResult) => void
  isCancelled?: () => boolean
  forceRefresh?: boolean
}

class SubtitleCatSearchCancelledError extends Error {
  constructor() { super("字幕搜索已停止。") }
}

export type SubtitleCatSearchEntry = { url: string; title: string }
type SubtitleCatRawFile = { url?: unknown; details?: unknown }
type CachedSubtitleCatDetail = { savedAt: number; files: SubtitleCatSubtitleFile[] }
type CachedSubtitleCatSearch = {
  savedAt: number
  touchedAt: number
  entries: SubtitleCatSearchEntry[]
  details: Record<string, CachedSubtitleCatDetail>
}

export async function searchSubtitleCatFiles(controller: WebViewController, value: string, options: SubtitleCatSearchOptions = {}): Promise<SubtitleCatSearchResult> {
  const videoCode = normalizeSubtitleCatVideoCode(value)
  const startedAt = Date.now()
  const metrics: SubtitleCatSearchMetrics = { elapsedMs: 0, firstResultMs: null, httpRequests: 0, webViewLoads: 0, searchCacheHits: 0, detailCacheHits: 0 }
  const checkCancelled = () => {
    if (options.isCancelled?.()) throw new SubtitleCatSearchCancelledError()
  }
  // HTTP requests may overlap; navigation on the shared native controller must not.
  let fallbackQueue: Promise<unknown> = Promise.resolve()
  const readPage = async (url: string): Promise<string> => {
    checkCancelled()
    metrics.httpRequests += 1
    const response = await readSubtitleCatPublicPage(url)
    checkCancelled()
    if (response.html) return response.html
    const fallback = fallbackQueue.then(async () => {
      checkCancelled()
      metrics.webViewLoads += 1
      return readSubtitleCatWebViewPage(controller, url, response.error, checkCancelled)
    })
    fallbackQueue = fallback.catch(() => {})
    return fallback
  }
  // The site's public GET search form uses index.php?search=...; show=1000 is its Load More link.
  const searchURL = `${SUBTITLECAT_ORIGIN}/index.php?search=${encodeURIComponent(videoCode)}&show=1000`
  const cached = readSubtitleCatSearchCache(videoCode)
  const entries = !options.forceRefresh && cached && isFreshSubtitleCatCache(cached.savedAt)
    ? cached.entries
    : parseSubtitleCatSearchHTML(await readPage(searchURL), videoCode)
  if (!options.forceRefresh && cached && entries === cached.entries) metrics.searchCacheHits += 1
  const cache: CachedSubtitleCatSearch = metrics.searchCacheHits
    ? cached!
    : { savedAt: Date.now(), touchedAt: Date.now(), entries, details: options.forceRefresh ? {} : cached?.details || {} }
  if (!metrics.searchCacheHits) writeSubtitleCatSearchCache(videoCode, cache)
  const files: SubtitleCatSubtitleFile[] = []
  const seen = new Set<string>()
  let failedDetailCount = 0
  let processedDetailCount = 0
  let nextEntry = 0
  const snapshot = (): SubtitleCatSearchResult => ({
    files: [...files].sort((left, right) => subtitleCatLanguagePriority(left.language) - subtitleCatLanguagePriority(right.language)),
    searchResultCount: entries.length,
    failedDetailCount,
    processedDetailCount,
    metrics: { ...metrics, elapsedMs: Date.now() - startedAt },
  })
  const publish = () => { checkCancelled(); options.onProgress?.(snapshot()) }
  const mergeFiles = (nextFiles: SubtitleCatSubtitleFile[]) => {
    for (const file of nextFiles) {
      if (seen.has(file.downloadURL)) continue
      seen.add(file.downloadURL)
      files.push(file)
    }
    if (files.length && metrics.firstResultMs === null) metrics.firstResultMs = Date.now() - startedAt
  }
  // Publish every cached detail together before scheduling any network work.
  const pendingEntries = entries.filter(entry => {
    const detail = !options.forceRefresh ? cache.details[entry.url] : undefined
    if (!detail || !isFreshSubtitleCatCache(detail.savedAt)) return true
    mergeFiles(detail.files)
    processedDetailCount += 1
    metrics.detailCacheHits += 1
    return false
  })
  publish()
  const worker = async () => {
    while (nextEntry < pendingEntries.length && !options.isCancelled?.()) {
      const entry = pendingEntries[nextEntry++]
      try {
        const html = await readPage(entry.url)
        checkCancelled()
        const detailFiles = parseSubtitleCatFileHTML(html, entry.url)
        mergeFiles(detailFiles)
        cache.details[entry.url] = { savedAt: Date.now(), files: detailFiles }
        cache.touchedAt = Date.now()
        writeSubtitleCatSearchCache(videoCode, cache)
      } catch (error) {
        if (error instanceof SubtitleCatSearchCancelledError || options.isCancelled?.()) return
        failedDetailCount += 1
      }
      processedDetailCount += 1
      publish()
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pendingEntries.length) }, worker))
  checkCancelled()
  if (entries.length && failedDetailCount === entries.length) {
    throw new Error(`Subtitle Cat 搜索到 ${entries.length} 个匹配条目，但详情页暂时无法读取，请重试。`)
  }
  const result = snapshot()
  console.log("Subtitle Cat search metrics", { videoCode, ...result.metrics, matchedDetails: entries.length, processedDetailCount, failedDetailCount })
  return result
}

function isFreshSubtitleCatCache(savedAt: number): boolean {
  const age = Date.now() - savedAt
  return Number.isFinite(savedAt) && age >= 0 && age < SUBTITLECAT_CACHE_TTL_MS
}

function loadSubtitleCatCacheRecords(): Record<string, CachedSubtitleCatSearch> {
  try {
    const raw = Storage.get<unknown>(SUBTITLECAT_CACHE_KEY)
    if (typeof raw !== "string" || raw.length > SUBTITLECAT_CACHE_MAX_CHARACTERS) return {}
    const stored = JSON.parse(raw)
    if (stored?.version !== 1 || !stored.records || typeof stored.records !== "object" || Array.isArray(stored.records)) return {}
    const records: Record<string, CachedSubtitleCatSearch> = {}
    for (const [code, record] of Object.entries(stored.records)) {
      if (!/^[A-Z0-9]{2,16}(?:-[A-Z0-9]{1,16}){0,2}$/.test(code) || !record || typeof record !== "object") continue
      const candidate = record as CachedSubtitleCatSearch
      if (!isFreshSubtitleCatCache(candidate.touchedAt) || !Array.isArray(candidate.entries) || !candidate.details || typeof candidate.details !== "object" || Array.isArray(candidate.details)) continue
      records[code] = candidate
    }
    return records
  } catch { return {} }
}

function readSubtitleCatSearchCache(code: string): CachedSubtitleCatSearch | null {
  const candidate = loadSubtitleCatCacheRecords()[code]
  if (!candidate) return null
  try {
    // Revalidate persisted URLs and exact code matching; corruption must trigger a new request.
    const links = candidate.entries.map(entry => {
      if (typeof entry?.url !== "string" || typeof entry?.title !== "string") throw new Error("Invalid cache entry")
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<a href="${escape(entry.url)}">${escape(entry.title)}</a>`
    }).join("")
    const entries = parseSubtitleCatSearchHTML(`<h2>${candidate.entries.length} subtitles found</h2>${links}`, code)
    if (entries.length !== candidate.entries.length) return null
    const details: Record<string, CachedSubtitleCatDetail> = {}
    for (const entry of entries) {
      const detail = candidate.details[entry.url]
      if (!detail || !isFreshSubtitleCatCache(detail.savedAt) || !Array.isArray(detail.files)) continue
      const files = parseSubtitleCatFileListing(JSON.stringify(detail.files.map(file => ({ url: file.downloadURL, details: file.details }))))
      if (files.length !== detail.files.length) continue
      details[entry.url] = { savedAt: detail.savedAt, files }
    }
    return { savedAt: candidate.savedAt, touchedAt: candidate.touchedAt, entries, details }
  } catch { return null }
}

function writeSubtitleCatSearchCache(code: string, record: CachedSubtitleCatSearch): void {
  try {
    const records = loadSubtitleCatCacheRecords()
    // Never retain stale/nonmatching details after an updated search result.
    const details: Record<string, CachedSubtitleCatDetail> = {}
    for (const entry of record.entries) {
      const detail = record.details[entry.url]
      if (detail && isFreshSubtitleCatCache(detail.savedAt)) details[entry.url] = detail
    }
    records[code] = { ...record, details }
    const keys = Object.keys(records).sort((left, right) => records[left].touchedAt - records[right].touchedAt)
    while (keys.length > SUBTITLECAT_CACHE_MAX_CODES) delete records[keys.shift()!]
    let serialized = JSON.stringify({ version: 1, records })
    while (serialized.length > SUBTITLECAT_CACHE_MAX_CHARACTERS && keys.length) {
      delete records[keys.shift()!]
      serialized = JSON.stringify({ version: 1, records })
    }
    Storage.set(SUBTITLECAT_CACHE_KEY, serialized)
  } catch { /* Cache failures must not interrupt search or download. */ }
}

export function parseSubtitleCatSearchHTML(html: string, value: string): SubtitleCatSearchEntry[] {
  const videoCode = normalizeSubtitleCatVideoCode(value)
  const visibleHTML = stripSubtitleCatScripts(html)
  const count = normalizeSubtitleCatText(visibleHTML).match(/\b(\d+)\s+subtitles?\s+found\b/i)
  if (!count || isSubtitleCatChallenge(html)) throw new Error("Subtitle Cat 没有返回可识别的搜索结果页，请稍后重试。")
  const escapedCode = videoCode.split("-").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]*")
  const codePattern = new RegExp(`(?:^|[^a-z0-9])${escapedCode}(?![a-z0-9])`, "i")
  const entries: SubtitleCatSearchEntry[] = []
  for (const anchor of visibleHTML.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = subtitleCatAttribute(anchor[1], "href")
    if (!href) continue
    const url = canonicalSubtitleCatURL(href)
    if (!url || !/^\/subs\/\d+\/[^/]+\.html$/i.test(url.pathname)) continue
    const title = normalizeSubtitleCatText(anchor[2])
    let path = url.pathname
    try { path = decodeURIComponent(path) } catch {}
    if (!codePattern.test(title) && !codePattern.test(path)) continue
    entries.push({ url: url.toString(), title })
  }
  // A positive result count without any result links indicates an incomplete/error document.
  if (Number(count[1]) > 0 && !/href\s*=\s*["'][^"']*\bsubs\//i.test(visibleHTML)) {
    throw new Error("Subtitle Cat 搜索结果尚未完整加载，请重试。")
  }
  return dedupeSubtitleCatEntries(entries)
}

export function parseSubtitleCatFileHTML(html: string, baseURL = SUBTITLECAT_HOME): SubtitleCatSubtitleFile[] {
  if (isSubtitleCatChallenge(html) || !/All language subtitles|id\s*=\s*["']download_/i.test(html)) {
    throw new Error("Subtitle Cat 没有返回可识别的字幕详情页，请重试。")
  }
  const visibleHTML = stripSubtitleCatScripts(html)
  const candidates: SubtitleCatRawFile[] = []
  for (const anchor of visibleHTML.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = subtitleCatAttribute(anchor[1], "href")
    if (!href || !/\.srt(?:[?#]|$)/i.test(href)) continue
    const url = canonicalSubtitleCatURL(href, baseURL)
    if (!url) continue
    const preceding = visibleHTML.slice(Math.max(0, anchor.index! - 400), anchor.index)
    const labels = [...preceding.matchAll(/<span\b[^>]*>([^<]+)<\/span>/gi)]
    const details = normalizeSubtitleCatText(labels.length ? labels[labels.length - 1][1] : anchor[2])
    candidates.push({ url: url.toString(), details })
  }
  return parseSubtitleCatFileListing(JSON.stringify(candidates))
}

export function parseSubtitleCatFileListing(payload: string): SubtitleCatSubtitleFile[] {
  let raw: unknown
  try { raw = JSON.parse(payload) }
  catch { throw new Error("Subtitle Cat 返回的字幕文件列表格式无法识别。") }
  if (!Array.isArray(raw)) return []

  const files: SubtitleCatSubtitleFile[] = []
  const seen = new Set<string>()
  for (const candidateValue of raw as unknown[]) {
    if (!candidateValue || typeof candidateValue !== "object") continue
    const candidate = candidateValue as SubtitleCatRawFile
    if (typeof candidate.url !== "string") continue
    const url = canonicalSubtitleCatURL(candidate.url)
    if (!url || !/^\/subs\/\d+\/[^/]+\.srt$/i.test(url.pathname)) continue
    if (seen.has(url.toString())) continue
    seen.add(url.toString())
    const details = normalizeSubtitleCatText(typeof candidate.details === "string" ? candidate.details : "")
    const filename = decodePathName(url.pathname)
    // The original filename can contain zh-cn even for an English/Traditional translation.
    const languageSuffix = filename.match(/-([a-z]{2,3}(?:[-_][a-z]{2,4})?)\.srt$/i)?.[1]
    const suffixLanguage = languageSuffix ? parseSubtitleCatLanguage(languageSuffix) : "其他语言"
    files.push({
      id: url.pathname,
      source: "SubtitleCat",
      language: suffixLanguage !== "其他语言" ? suffixLanguage : parseSubtitleCatLanguage(details),
      details: details || filename,
      downloadURL: url.toString(),
      isFree: true,
      isDemo: false,
    })
  }
  files.sort((left, right) => subtitleCatLanguagePriority(left.language) - subtitleCatLanguagePriority(right.language))
  return files
}

export async function downloadSubtitleCatFile(file: SubtitleCatSubtitleFile): Promise<string> {
  const url = canonicalSubtitleCatURL(file.downloadURL)
  if (!url || !/^\/subs\/\d+\/[^/]+\.srt$/i.test(url.pathname)) {
    throw new Error("Subtitle Cat 字幕下载地址不安全，已取消下载。")
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "text/plain, application/x-subrip, */*", "User-Agent": SUBTITLECAT_USER_AGENT },
    timeout: 45,
    debugLabel: "Download Subtitle Cat SRT",
    handleRedirect: async request => {
      try {
        const target = new URL(request.url)
        return canonicalSubtitleCatURL(target.toString()) ? request : null
      } catch { return null }
    },
  })
  if (!response.ok) throw new Error(`Subtitle Cat 字幕下载失败（HTTP ${response.status}）。`)
  const content = await response.text()
  if (isSubtitleCatChallenge(content) || /^\s*<!doctype\s+html/i.test(content)) throw new Error("Subtitle Cat 暂时没有返回字幕文件，请稍后重试或完成网站验证。")
  return content
}

async function readSubtitleCatPublicPage(url: string): Promise<{ html?: string; error: string }> {
  let requestError = "公开页面请求失败"
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html, application/xhtml+xml", "User-Agent": SUBTITLECAT_USER_AGENT },
      timeout: 20,
      debugLabel: "Search Subtitle Cat public subtitles",
      handleRedirect: async request => canonicalSubtitleCatURL(request.url) ? request : null,
    })
    const html = await response.text()
    const recognizable = new URL(url).pathname === "/index.php"
      ? /\b\d+\s+subtitles?\s+found\b/i.test(normalizeSubtitleCatText(stripSubtitleCatScripts(html)))
      : /All language subtitles|id\s*=\s*["']download_/i.test(html)
    if (response.ok && recognizable && !isSubtitleCatChallenge(html)) return { html, error: "" }
    requestError = response.ok ? "页面暂时未能返回正常内容" : `公开页面请求失败（HTTP ${response.status}）`
  } catch (reason) {
    requestError = reason instanceof Error && /timeout|超时/i.test(reason.message) ? "公开页面请求超时" : requestError
  }

  return { error: requestError }
}

async function readSubtitleCatWebViewPage(controller: WebViewController, url: string, requestError: string, checkCancelled: () => void): Promise<string> {
  // A failed subresource/waitForLoad flag must not discard a usable main document.
  try { await loadWebViewPage(controller, url, 20_000) } catch {}
  checkCancelled()
  let html = await controller.getHTML()
  checkCancelled()
  let currentURL = canonicalSubtitleCatURL(await controller.evaluateJavaScript<string>("return location.href"))
  checkCancelled()
  if (html && currentURL && isSubtitleCatChallenge(html)) {
    await Dialog.alert({ title: "需要完成网站验证", message: "Subtitle Cat 要求先验证访问线路。请在随后打开的网页中完成验证并关闭网页，应用会继续搜索。" })
    checkCancelled()
    await controller.present({ fullscreen: true, navigationTitle: "Subtitle Cat 验证" })
    checkCancelled()
    html = await controller.getHTML()
    checkCancelled()
    currentURL = canonicalSubtitleCatURL(await controller.evaluateJavaScript<string>("return location.href"))
    checkCancelled()
  }
  const expectedURL = canonicalSubtitleCatURL(url)!
  const matchesPage = currentURL?.pathname === expectedURL.pathname
    && currentURL.searchParams.get("search") === expectedURL.searchParams.get("search")
  if (!html?.trim() || !matchesPage) throw new Error(`Subtitle Cat ${requestError}，网页也未能载入，请检查网络后重试。`)
  if (isSubtitleCatChallenge(html)) throw new Error("Subtitle Cat 验证尚未完成，暂时无法读取字幕。")
  return html
}

function parseSubtitleCatLanguage(text: string): string {
  const value = text.toLowerCase()
  if (/zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?mo|cht|traditional\s+chinese|chinese\s*\(\s*traditional\s*\)/i.test(value)) return "繁体中文"
  if (/zh[-_. ]?cn|zh[-_. ]?sg|chs|simplified\s+chinese|chinese\s*\(\s*simplified\s*\)/i.test(value)) return "简体中文"
  if (/(?:^|[^a-z])en(?:g)?(?:[^a-z]|$)|english/i.test(value)) return "英语"
  if (/(?:^|[^a-z])ja(?:p)?(?:[^a-z]|$)|japanese/i.test(value)) return "日语"
  if (/(?:^|[^a-z])ko(?:r)?(?:[^a-z]|$)|korean/i.test(value)) return "韩语"
  if (/(?:^|[^a-z])id(?:o)?(?:[^a-z]|$)|indonesian/i.test(value)) return "印尼语"
  if (/(?:^|[^a-z])th(?:a)?(?:[^a-z]|$)|thai/i.test(value)) return "泰语"
  if (/(?:^|[^a-z])vi(?:e)?(?:[^a-z]|$)|vietnamese/i.test(value)) return "越南语"
  if (/(?:^|[^a-z])es(?:p)?(?:[^a-z]|$)|spanish/i.test(value)) return "西班牙语"
  if (/(?:^|[^a-z])tr(?:[^a-z]|$)|turkish/i.test(value)) return "土耳其语"
  return "其他语言"
}

function subtitleCatLanguagePriority(language: string): number {
  if (language === "简体中文") return 0
  if (language === "繁体中文") return 1
  return 2
}

function normalizeSubtitleCatVideoCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s+/g, "-")
  if (!/^[A-Z0-9]{2,16}(?:-[A-Z0-9]{1,16}){0,2}$/.test(code)) throw new Error("请输入有效的作品番号。")
  return code
}

function dedupeSubtitleCatEntries(entries: SubtitleCatSearchEntry[]): SubtitleCatSearchEntry[] {
  const seen = new Set<string>()
  return entries.filter(entry => {
    const url = canonicalSubtitleCatURL(entry.url)
    if (!url || !/^\/subs\/\d+\/[^/]+\.html$/i.test(url.pathname)) return false
    const key = url.toString()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function decodePathName(pathname: string): string {
  const value = pathname.split("/").pop() || ""
  try { return decodeURIComponent(value) }
  catch { return value }
}

function normalizeSubtitleCatText(value: string): string {
  return decodeSubtitleCatEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function decodeSubtitleCatEntities(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, raw: string) => {
      const code = raw[0].toLowerCase() === "x" ? parseInt(raw.slice(1), 16) : Number(raw)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    })
}

function subtitleCatAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
  return match ? decodeSubtitleCatEntities(match[1] ?? match[2]) : ""
}

function canonicalSubtitleCatURL(value: string, baseURL = SUBTITLECAT_HOME): URL | null {
  try {
    const url = new URL(value, baseURL)
    if (url.protocol !== "https:" || !["www.subtitlecat.com", "subtitlecat.com"].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) return null
    url.hostname = "www.subtitlecat.com"
    url.pathname = url.pathname.split("/").map(part => {
      try { return encodeURIComponent(decodeURIComponent(part)) } catch { return part }
    }).join("/")
    return url
  } catch { return null }
}

function stripSubtitleCatScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
}

function isSubtitleCatChallenge(value: string): boolean {
  // Ordinary SRT/VTT dialogue can say "just a moment" without being a security page.
  if (/^(?:WEBVTT(?:\s|$)|\d+\s*\r?\n\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->)/.test(value.replace(/^\uFEFF/, "").trimStart())) return false
  const title = normalizeSubtitleCatText(value.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  const markers = /just a moment|verify you are human|checking your browser|attention required|sorry, you have been blocked|security verification|请验证您是真人/i
  if (markers.test(title)) return true
  if (/All language subtitles|\b\d+\s+subtitles?\s+found\b/i.test(value)) return false
  return markers.test(value) || /cdn-cgi\/challenge-platform|cf-chl-/i.test(value)
}
