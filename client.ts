import { fetch } from "scripting"
import { getMissAVBaseURL } from "./domain"
import { captureCloudflareSession, restoreCloudflareSession } from "./cloudflare-session"
import * as SiteHTML from "./html-parser"
import { loadWebViewPage } from "./webview"

export {
  cleanText,
  extractMissAVVideoCode,
  hasNextPage,
  isCloudflareChallengeHTML,
  isLikelyMissAVHTML,
  normalizeMissAVUrl,
  parseMissAVSources,
  parseMissAVVideoItems,
} from "./html-parser"

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

const SEARCH_PAGE_CACHE_TTL_MS = 45_000
const MAX_CACHED_SEARCH_PAGES = 24
type CachedSearchPage = { expiresAt: number; value: MissAVSearchPage }
type PendingSearchPage = { requestId: number; forceRefresh: boolean; promise: Promise<MissAVSearchPage> }

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
  private searchPageCache = new Map<string, CachedSearchPage>()
  private searchPageRequests = new Map<string, PendingSearchPage>()
  private searchRequestId = 0

  async searchVideoPage(params: MissAVSearchParams, options: { forceRefresh?: boolean } = {}): Promise<MissAVSearchPage> {
    const page = Math.max(1, Math.floor(params.page || 1))
    const url = this.collectionUrl(params)
    const forceRefresh = options.forceRefresh === true
    const cached = this.searchPageCache.get(url)
    if (!forceRefresh && cached) {
      if (cached.expiresAt > Date.now()) {
        this.searchPageCache.delete(url)
        this.searchPageCache.set(url, cached)
        return copySearchPage(cached.value)
      }
      this.searchPageCache.delete(url)
    }
    const pending = this.searchPageRequests.get(url)
    if (pending && (!forceRefresh || pending.forceRefresh)) return pending.promise.then(copySearchPage)

    const requestId = ++this.searchRequestId
    const request = (async () => {
      const html = await this.fetchHtml(url)
      return SiteHTML.parseMissAVSearchPage(html, page)
    })()
    const tracked = request.then(value => {
      if (this.searchPageRequests.get(url)?.requestId === requestId) {
        if (this.searchPageCache.size >= MAX_CACHED_SEARCH_PAGES) {
          const oldestKey = this.searchPageCache.keys().next().value
          if (oldestKey) this.searchPageCache.delete(oldestKey)
        }
        this.searchPageCache.set(url, { expiresAt: Date.now() + SEARCH_PAGE_CACHE_TTL_MS, value })
      }
      return value
    }).finally(() => {
      if (this.searchPageRequests.get(url)?.requestId === requestId) this.searchPageRequests.delete(url)
    })
    this.searchPageRequests.set(url, { requestId, forceRefresh, promise: tracked })
    return tracked.then(copySearchPage)
  }

  async getVideo(item: MissAVVideoItem | string): Promise<MissAVVideoDetail> {
    const videoCode = typeof item === "string" ? SiteHTML.extractMissAVVideoCode(item) : item.videoCode
    if (!videoCode) throw new Error("缺少 MISSAV 视频标识符。")
    const watchUrl = typeof item === "string" ? this.watchUrl(videoCode) : SiteHTML.normalizeMissAVUrl(item.detailPath)
    const html = await this.fetchHtml(watchUrl)
    return SiteHTML.parseMissAVVideoDetail(html, videoCode, watchUrl)
  }

  watchUrl(videoCode: string): string { return new URL(`${MISSAV_LOCALE}/${SiteHTML.extractMissAVVideoCode(videoCode) || videoCode}`, getMissAVBaseURL()).toString() }
  browseProbeURL(): string { return this.collectionUrl({ collection: "new", page: 1, sort: "released_at" }) }
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
    // Use the same persistent WebKit session as the verification window.
    // `scripting.fetch` has a separate cookie jar and a manually supplied UA,
    // so Cloudflare can accept the WebView while returning 403 to fetch.
    const controller = new WebViewController()
    try {
      await restoreCloudflareSession(controller, new URL(url).hostname)
      const { loaded, finished, html } = await loadWebViewPage(controller, url)

      if (SiteHTML.isCloudflareChallengeHTML(html)) {
        throw new Error("当前线路需要 Cloudflare 验证。请到设置页点击“验证访问线路”，完成验证后再重试。")
      }
      try { await captureCloudflareSession(controller, new URL(url).hostname) } catch { /* Cookie persistence is best-effort; page parsing remains authoritative. */ }
      if (!loaded || !finished || !html) throw new Error("当前域名未返回页面内容，请在设置页切换线路后重试。")
      if (SiteHTML.isLikelyMissAVHTML(html)) return html
      throw new Error("当前域名未返回可识别的 MISSAV 页面。请在设置页切换线路后重试。")
    } finally {
      controller.dispose()
    }
  }

  private requestHeaders(referer?: string): Record<string, string> { return { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.8", ...(referer ? { Referer: referer } : {}) } }
}

function copySearchPage(value: MissAVSearchPage): MissAVSearchPage {
  return { ...value, items: value.items.map(item => ({ ...item })) }
}

export const missavClient = new MissAVClient()
