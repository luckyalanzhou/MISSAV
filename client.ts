import { fetch } from "scripting"
import { getMissAVBaseURL, resolveMissAVURL } from "./domain"

export const MISSAV_BASE_URL = () => getMissAVBaseURL()
export const MISSAV_LOCALE = "ja"
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

export type MissAVCollection = "new" | "release" | "uncensored-leak" | "english-subtitle" | "fc2" | "today-hot" | "weekly-hot" | "monthly-hot"
export type MissAVSort = "released_at" | "published_at" | "today_views" | "weekly_views" | "monthly_views" | "views" | "saved"
export type MissAVFilter = "" | "individual" | "multiple" | "uncensored" | "uncensored-leak" | "english-subtitle" | "chinese-subtitle" | "jav"
export type MissAVVideoItem = { title: string; videoCode: string; detailPath: string; coverUrl: string; duration?: string; badge?: string }
export type MissAVVideoSource = { label: string; qualityHeight?: number; url: string; type: "application/vnd.apple.mpegurl" | "video/mp4" }
export type MissAVVideoDetail = { title: string; videoCode: string; coverUrl: string; duration?: string; releaseDate?: string; actress?: string; genres: string[]; maker?: string; sources: MissAVVideoSource[]; watchUrl: string }
export type MissAVSearchParams = { collection?: MissAVCollection; query?: string; page?: number; sort?: MissAVSort; filter?: MissAVFilter }
export type MissAVSearchPage = { items: MissAVVideoItem[]; page: number; hasNext: boolean; title: string }

export const MISSAV_COLLECTION_OPTIONS: ReadonlyArray<{ value: MissAVCollection; title: string; systemImage: string }> = [
  { value: "new", title: "最近更新", systemImage: "clock.arrow.circlepath" },
  { value: "release", title: "新作", systemImage: "sparkles" },
  { value: "uncensored-leak", title: "无码流出", systemImage: "lock.open" },
  { value: "english-subtitle", title: "英文字幕", systemImage: "captions.bubble" },
  { value: "fc2", title: "FC2", systemImage: "person.crop.rectangle.stack" },
  { value: "today-hot", title: "今日观看最多", systemImage: "flame" },
  { value: "weekly-hot", title: "本周观看最多", systemImage: "chart.line.uptrend.xyaxis" },
  { value: "monthly-hot", title: "本月观看最多", systemImage: "calendar" },
]
export const MISSAV_SORT_OPTIONS: ReadonlyArray<{ value: MissAVSort; title: string; systemImage: string }> = [
  { value: "released_at", title: "发行日期", systemImage: "calendar.badge.clock" },
  { value: "published_at", title: "最近收录", systemImage: "clock" },
  { value: "today_views", title: "今日观看", systemImage: "sun.max" },
  { value: "weekly_views", title: "本周观看", systemImage: "calendar.day.timeline.left" },
  { value: "monthly_views", title: "本月观看", systemImage: "calendar" },
  { value: "views", title: "总观看数", systemImage: "play.circle" },
  { value: "saved", title: "最多收藏", systemImage: "bookmark" },
]
export const MISSAV_FILTER_OPTIONS: ReadonlyArray<{ value: MissAVFilter; title: string; systemImage: string }> = [
  { value: "", title: "全部作品", systemImage: "rectangle.grid.1x2" },
  { value: "individual", title: "单体作品", systemImage: "person" },
  { value: "multiple", title: "多人作品", systemImage: "person.3" },
  { value: "jav", title: "日本 AV", systemImage: "film" },
  { value: "uncensored", title: "无码", systemImage: "lock.open" },
  { value: "uncensored-leak", title: "无码流出", systemImage: "arrow.down.circle" },
  { value: "english-subtitle", title: "英文字幕", systemImage: "captions.bubble" },
  { value: "chinese-subtitle", title: "中文字幕", systemImage: "character.book.closed" },
]

class MissAVClient {
  async searchVideoPage(params: MissAVSearchParams): Promise<MissAVSearchPage> {
    const page = Math.max(1, Math.floor(params.page || 1))
    const url = this.collectionUrl(params)
    const html = await this.fetchHtml(url)
    return { items: parseMissAVVideoItems(html), page, hasNext: hasNextPage(html, page), title: cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) }
  }

  async getVideo(item: MissAVVideoItem | string): Promise<MissAVVideoDetail> {
    const videoCode = typeof item === "string" ? extractMissAVVideoCode(item) : item.videoCode
    if (!videoCode) throw new Error("缺少 MISSAV 视频标识符。")
    const watchUrl = typeof item === "string" ? this.watchUrl(videoCode) : normalizeMissAVUrl(item.detailPath)
    const html = await this.fetchHtml(watchUrl)
    const title = meta(html, "og:title") || cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) || videoCode.toUpperCase()
    const coverUrl = normalizeMissAVUrl(meta(html, "og:image") || firstMatch(html, /<video\b[^>]*\bdata-poster=["']([^"']+)/i))
    const durationSeconds = Number(meta(html, "og:video:duration"))
    const releaseDate = meta(html, "og:video:release_date") || undefined
    const actress = meta(html, "og:video:actor") || cleanText(firstMatch(html, /<a\b[^>]*href=["'][^"']*\/actresses\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)) || undefined
    const genres = unique([...html.matchAll(/<a\b[^>]*href=["'][^"']*\/genres\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match => cleanText(match[1])).filter(Boolean)).slice(0, 30)
    const maker = cleanText(firstMatch(html, /<a\b[^>]*href=["'][^"']*\/makers\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)) || undefined
    const sources = parseMissAVSources(html)
    return { title, videoCode, coverUrl, duration: durationSeconds > 0 ? formatDuration(durationSeconds) : undefined, releaseDate, actress, genres, maker, sources, watchUrl }
  }

  watchUrl(videoCode: string): string { return new URL(`${MISSAV_LOCALE}/${extractMissAVVideoCode(videoCode) || videoCode}`, getMissAVBaseURL()).toString() }
  playbackHeaders(watchUrl: string, resourceUrl: string): Record<string, string> { return { ...this.requestHeaders(watchUrl), Referer: watchUrl, Origin: new URL(watchUrl).origin, Accept: "*/*" } }
  async loadCoverImage(url: string, watchUrl: string): Promise<UIImage | null> { try { const response = await fetch(url, { headers: this.requestHeaders(watchUrl) }); return response.ok ? UIImage.fromData(await response.data()) : null } catch { return null } }

  private collectionUrl(params: MissAVSearchParams): string {
    const query = params.query?.trim()
    const path = query ? `${MISSAV_LOCALE}/search/${encodeURIComponent(query.replace(/\\/g, ""))}` : `${MISSAV_LOCALE}/${params.collection || "new"}`
    const url = new URL(path, getMissAVBaseURL())
    if (params.filter) url.searchParams.set("filters", params.filter)
    if (params.sort) url.searchParams.set("sort", params.sort)
    if ((params.page || 1) > 1) url.searchParams.set("page", String(Math.max(1, Math.floor(params.page || 1))))
    return url.toString()
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, { headers: this.requestHeaders() })
    const html = await response.text()
    if (response.ok) return html

    if (response.status === 403) {
      // Scripting fetch is a separate HTTP client and does not keep WebView's
      // Cloudflare cookies. Retry through the persistent WebKit store, which
      // is also used by the Settings verification flow.
      const controller = new WebViewController()
      try {
        const loaded = await controller.loadURL(url)
        if (loaded) await controller.waitForLoad()
        let webViewHTML = await controller.getHTML()
        for (let attempt = 0; attempt < 4 && isCloudflareChallengeHTML(webViewHTML); attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 600))
          webViewHTML = await controller.getHTML()
        }
        if (isLikelyMissAVHTML(webViewHTML) && !isCloudflareChallengeHTML(webViewHTML)) return webViewHTML
        if (isCloudflareChallengeHTML(webViewHTML) || isCloudflareChallengeHTML(html) || response.headers.get("cf-mitigated")) {
          throw new Error("当前域名返回 Cloudflare 403。请先到设置页打开“验证访问线路”并完成验证，再重试。")
        }
      } finally {
        controller.dispose()
      }
    }

    throw new Error(`MISSAV 页面加载失败（HTTP 状态码 ${response.status}）。`)
  }

  private requestHeaders(referer?: string): Record<string, string> { return { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.8", ...(referer ? { Referer: referer } : {}) } }
}

function isCloudflareChallengeHTML(html: string | null): boolean {
  return Boolean(html && /cf-mitigated|cf_chl_|cf-chl-|__cf_chl|challenge-platform|cf-turnstile|challenges\.cloudflare\.com|just a moment|checking (?:your )?browser|verify you are human|human verification|performing security verification|attention required|cloudflare.{0,40}(?:challenge|verify)|(?:challenge|verify).{0,40}cloudflare|正在进行安全验证|验证您不是自动程序|请验证您是真人|人机验证/i.test(html))
}

function isLikelyMissAVHTML(html: string | null): html is string {
  return Boolean(html && /missav/i.test(html) && /<(?:html|body|main|video|meta)\b/i.test(html) && html.length > 500)
}

export const missavClient = new MissAVClient()

export function extractMissAVVideoCode(value: string | undefined | null): string | null {
  if (!value) return null
  const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/^\/dm\d+/i, "").replace(/^\/(?:ja|en|cn|ko|ms|th|de|fr|vi|id|fil|pt)\//i, "/")
  const slug = decodeURIComponent(path.replace(/^\/+|\/+$/g, ""))
  return slug && !/^(?:new|release|uncensored-leak|english-subtitle|fc2|today-hot|weekly-hot|monthly-hot|search|genres|makers|actresses)$/i.test(slug) ? slug.toLowerCase() : null
}

export function parseMissAVVideoItems(html: string): MissAVVideoItem[] {
  const result: MissAVVideoItem[] = []
  const seen = new Set<string>()
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  for (let index = 0; index < links.length; index += 1) {
    const match = links[index]
    const detailPath = decodeHtml(match[1])
    const videoCode = extractMissAVVideoCode(detailPath)
    if (!videoCode || seen.has(videoCode) || !isLikelyMissAVVideoCode(videoCode) || /\/(?:genres|makers|actresses|labels|site|search|vip|upload|contact|terms)\//i.test(detailPath)) continue

    // A real card exposes cover, duration and title as adjacent links sharing one detail URL.
    const cardLinks: RegExpMatchArray[] = []
    for (let cursor = index; cursor < links.length; cursor += 1) {
      const candidateCode = extractMissAVVideoCode(decodeHtml(links[cursor][1]))
      if (candidateCode !== videoCode) break
      cardLinks.push(links[cursor])
    }
    const cardHtml = cardLinks.map(item => item[0]).join(" ")
    const imageTag = firstMatch(cardHtml, /(<img\b[^>]*>)/i)
    const imageTitle = cleanText(attr(imageTag, "alt"))
    const linkTexts = cardLinks.map(item => cleanText(item[2])).filter(text => text && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text))
    const title = linkTexts.sort((a, b) => b.length - a.length)[0] || imageTitle || cleanText(attr(cardHtml, "title"))
    const coverUrl = normalizeMissAVUrl(attr(imageTag, "data-src") || attr(imageTag, "data-original") || attr(imageTag, "src"))
    const duration = cleanText(firstMatch(cardHtml, /(\d{1,2}:\d{2}(?::\d{2})?)/i))
    if (!title || title.length < 3 || !duration || (!coverUrl && !imageTitle)) continue
    seen.add(videoCode)
    result.push({ title, videoCode, detailPath: normalizeMissAVUrl(detailPath), coverUrl, duration, badge: /uncensored-leak/i.test(videoCode) ? "无码流出" : /english-subtitle/i.test(videoCode) ? "英文字幕" : undefined })
    index += Math.max(0, cardLinks.length - 1)
  }
  return result
}

function isLikelyMissAVVideoCode(value: string): boolean { return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value) && /\d/.test(value) }

export function parseMissAVSources(html: string): MissAVVideoSource[] {
  const candidates = [
    ...[...html.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]),
    ...[...html.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]),
    ...[...html.matchAll(/["'](https?:\\?\/\\?\/[^"']+?\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi)].map(match => match[1]),
    ...unpackPackerMediaUrls(html),
  ]
  const sources: MissAVVideoSource[] = []
  const seenResources = new Set<string>()
  for (const candidate of candidates) {
    const url = validPlaybackUrl(candidate)
    if (!url) continue
    const resourceKey = playbackResourceKey(url)
    if (seenResources.has(resourceKey)) continue
    seenResources.add(resourceKey)
    const label = qualityLabel(url)
    sources.push({ label, qualityHeight: qualityHeight(label), url, type: isHlsUrl(url) ? "application/vnd.apple.mpegurl" : "video/mp4" })
  }
  return deduplicatePlaybackChoices(sources).sort((a, b) => qualityNumber(b.label) - qualityNumber(a.label))
}

function unpackPackerMediaUrls(html: string): string[] {
  const result: string[] = []
  for (const match of html.matchAll(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\)/gi)) {
    const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\"); const radix = Number(match[2]); const words = match[4].replace(/\\'/g, "'").split("|")
    if (!payload || radix < 2 || radix > 36) continue
    const decoded = payload.replace(/\b[0-9a-z]+\b/gi, token => { const index = Number.parseInt(token, radix); return Number.isFinite(index) && words[index] ? words[index] : token })
    for (const urlMatch of decoded.matchAll(/https?:\/\/[^'"\s]+?\.(?:m3u8|mp4)(?:\?[^'"\s]*)?/gi)) result.push(urlMatch[0])
  }
  return result
}

function hasNextPage(html: string, page: number): boolean { return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].some(match => { try { return Number(new URL(decodeHtml(match[1]), getMissAVBaseURL()).searchParams.get("page")) === page + 1 } catch { return false } }) }
function qualityLabel(url: string): string {
  const match = /(?:^|[/_.-])(\d{3,4})p?(?=[/_.?&=-]|$)/i.exec(url) || /[?&](?:quality|res(?:olution)?|height|q)=(\d{3,4})(?:&|$)/i.exec(url) || /(?:^|[/_.-])\d{3,4}x(\d{3,4})(?=[/_.?&=-]|$)/i.exec(url)
  return match ? `${match[1]}p` : "自动清晰度"
}
function qualityNumber(label: string): number { return Number.parseInt(label, 10) || 0 }
function qualityHeight(label: string): number | undefined { const value = qualityNumber(label); return value > 0 ? value : undefined }
function validPlaybackUrl(value: string): string | null {
  const decoded = decodeTransportUrl(value)
  if (!/^https?:\/\//i.test(decoded) || /(?:\$\{|\{\{|\b(?:undefined|null)\b)/i.test(decoded)) return null
  try {
    const url = new URL(decoded)
    if (!/\.(?:m3u8|mp4)$/i.test(url.pathname) || /(?:^|\/)preview\.mp4$/i.test(url.pathname)) return null
    return url.toString()
  } catch { return null }
}
function isHlsUrl(url: string): boolean { try { return /\.m3u8$/i.test(new URL(url).pathname) } catch { return false } }
function playbackResourceKey(url: string): string { try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}` } catch { return url } }
function deduplicatePlaybackChoices(sources: MissAVVideoSource[]): MissAVVideoSource[] {
  const result: MissAVVideoSource[] = []
  const fixedHeights = new Set<number>()
  let hasAutomatic = false
  for (const source of sources) {
    if (source.qualityHeight != null) {
      if (fixedHeights.has(source.qualityHeight)) continue
      fixedHeights.add(source.qualityHeight)
    } else {
      if (hasAutomatic) continue
      hasAutomatic = true
    }
    result.push(source)
  }
  return result
}
function meta(html: string, name: string): string { const tag = firstMatch(html, new RegExp(`(<meta\\b(?=[^>]*(?:property|name)=["']${escapeRegExp(name)}["'])[^>]*>)`, "i")); return cleanText(attr(tag, "content")) }
function attr(value: string, name: string): string { return firstMatch(value, new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)`, "i")) }
function firstMatch(value: string, regex: RegExp): string { return regex.exec(value)?.[1] || "" }
function normalizeMissAVUrl(value: string): string { return resolveMissAVURL(decodeTransportUrl(value)) }
function decodeTransportUrl(value: string): string { return decodeHtml(value).replace(/\\\//g, "/").replace(/\\u0026/gi, "&").trim() }
export function cleanText(value: string): string { return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }
function decodeHtml(value: string): string { let result = value; for (let pass = 0; pass < 3; pass += 1) { const next = result.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|nbsp|lt|gt);/gi, (entity, decimal, hexadecimal) => decimal ? String.fromCodePoint(Number(decimal)) : hexadecimal ? String.fromCodePoint(Number.parseInt(hexadecimal, 16)) : ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" } as Record<string, string>)[entity.toLowerCase()] || entity); if (next === result) break; result = next } return result }
function unique(values: string[]): string[] { return [...new Set(values)] }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function formatDuration(seconds: number): string { const value = Math.max(0, Math.floor(seconds)); const h = Math.floor(value / 3600); const m = Math.floor((value % 3600) / 60); const s = value % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}` }
