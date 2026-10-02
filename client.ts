import { fetch } from "scripting"
import { getMissAVBaseURL, MISSAV_ACCEPT_LANGUAGE, MISSAV_LOCALE, resolveMissAVURL } from "./domain"
import { captureCloudflareSession, restoreCloudflareSession } from "./cloudflare-session"
import * as SiteHTML from "./html-parser"
import { loadWebViewPage } from "./webview"
import { defaultMissAVCollectionSort, isMissAVDirectoryCollection, MISSAV_COLLECTION_GROUPS, MISSAV_COLLECTION_OPTIONS, type MissAVCollection, type MissAVFilter, type MissAVSort } from "./collections"

export { collectionOptionsForGroup, defaultMissAVCollectionSort, isMissAVDirectoryCollection, MISSAV_COLLECTION_GROUPS, MISSAV_COLLECTION_OPTIONS, type MissAVCollection, type MissAVCollectionGroup, type MissAVFilter, type MissAVSort } from "./collections"

export {
  cleanText,
  extractMissAVVideoCode,
  hasNextPage,
  isCloudflareChallengeHTML,
  isLikelyMissAVHTML,
  isLikelyMissAVListingHTML,
  normalizeMissAVUrl,
  parseMissAVDirectoryPage,
  parseMissAVSources,
  parseMissAVVideoItems,
} from "./html-parser"

export const MISSAV_BASE_URL = () => getMissAVBaseURL()
export { MISSAV_LOCALE } from "./domain"
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

export type MissAVVideoItem = { title: string; videoCode: string; detailPath: string; coverUrl: string; duration?: string; badge?: string }
export type MissAVVideoSource = { label: string; qualityHeight?: number; url: string; type: "application/vnd.apple.mpegurl" | "video/mp4" }
export type MissAVVideoDetail = { title: string; videoCode: string; coverUrl: string; duration?: string; releaseDate?: string; actress?: string; genres: string[]; maker?: string; sources: MissAVVideoSource[]; watchUrl: string }
export type MissAVCategoryItem = { title: string; path: string; coverUrl?: string }
export type MissAVSearchParams = { collection?: MissAVCollection; query?: string; page?: number; sort?: MissAVSort; filter?: MissAVFilter; categoryPath?: string }
export type MissAVSearchPage = { items: MissAVVideoItem[]; categories?: MissAVCategoryItem[]; page: number; hasNext: boolean; title: string }
export type MissAVAccessProbe = { collection: MissAVCollection; title: string; url: string; params: MissAVSearchParams }

const SEARCH_PAGE_CACHE_TTL_MS = 45_000
const MAX_CACHED_SEARCH_PAGES = 24
type CachedSearchPage = { expiresAt: number; value: MissAVSearchPage }
type PendingSearchPage = { requestId: number; forceRefresh: boolean; promise: Promise<MissAVSearchPage> }
class MissAVPageContentError extends Error {}

export const MISSAV_SORT_OPTIONS: ReadonlyArray<{ value: MissAVSort; title: string; systemImage: string }> = [
  { value: "released_at", title: "发行日期", systemImage: "calendar.badge.clock" },
  { value: "published_at", title: "最近更新", systemImage: "clock" },
  { value: "today_views", title: "今日观看", systemImage: "sun.max" },
  { value: "weekly_views", title: "本周观看", systemImage: "calendar.day.timeline.left" },
  { value: "monthly_views", title: "本月观看", systemImage: "calendar" },
  { value: "views", title: "总观看数", systemImage: "play.circle" },
  { value: "saved", title: "最多收藏", systemImage: "bookmark" },
]
export const MISSAV_FILTER_OPTIONS: ReadonlyArray<{ value: MissAVFilter; title: string; systemImage: string }> = [
  { value: "", title: "全部作品", systemImage: "rectangle.grid.1x2" },
  { value: "individual", title: "单人作品", systemImage: "person" },
  { value: "multiple", title: "多人作品", systemImage: "person.3" },
  { value: "chinese-subtitle", title: "中文字幕", systemImage: "character.book.closed" },
]

class MissAVClient {
  private collectionPaths = new Map<string, Partial<Record<MissAVCollection, string>>>()
  private verificationRequests = new Map<string, MissAVSearchParams>()
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
      let html: string
      try { html = await this.fetchHtml(url) }
      catch (error) {
        if (!(error instanceof MissAVPageContentError) || params.query || params.categoryPath || !params.collection || params.collection === "new") throw error
        if (new URL(getMissAVBaseURL()).origin !== new URL(url).origin) throw error
        // On a cold launch, obtain the current menu from the working Browse
        // entry before retrying a route that did not return a document.
        await this.fetchHtml(this.browseProbeURL())
        if (new URL(getMissAVBaseURL()).origin !== new URL(url).origin) throw error
        const resolvedURL = this.collectionUrl(params)
        if (resolvedURL === url) throw error
        html = await this.fetchHtml(resolvedURL)
      }
      const result = params.collection && isMissAVDirectoryCollection(params.collection) && !params.categoryPath && !params.query
        ? SiteHTML.parseMissAVDirectoryPage(html, page, params.collection, url)
        : SiteHTML.parseMissAVSearchPage(html, page)
      if (!params.query && page === 1 && (params.collection === undefined || params.collection === "new" || params.collection === "today-hot") && result.items.length === 0) {
        throw new Error(`首页/浏览列表没有解析到作品（${new URL(url).pathname}）。页面内容可能尚未完成加载，请稍后重试；若持续失败，请在设置页检查访问线路。`)
      }
      return result
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
    }).catch(error => {
      if (params.collection && error instanceof Error && error.message.includes("当前线路需要 Cloudflare 验证")) this.verificationRequests.set(url, { ...params })
      throw error
    }).finally(() => {
      if (this.searchPageRequests.get(url)?.requestId === requestId) this.searchPageRequests.delete(url)
    })
    this.searchPageRequests.set(url, { requestId, forceRefresh, promise: tracked })
    return tracked.then(copySearchPage)
  }

  clearSearchPageCache(): void {
    this.searchPageCache.clear()
    this.searchPageRequests.clear()
    this.searchRequestId += 1
  }

  clearVerificationCollections(): void {
    const origin = new URL(getMissAVBaseURL()).origin
    for (const url of this.verificationRequests.keys()) if (new URL(url).origin === origin) this.verificationRequests.delete(url)
  }

  rememberCollectionRoutes(html: string | null, pageURL: string): void {
    if (!html || SiteHTML.isCloudflareChallengeHTML(html) || !SiteHTML.isLikelyMissAVHTML(html)) return
    const origin = new URL(pageURL).origin
    const links = SiteHTML.parseMissAVCollectionLinks(html, pageURL)
    this.collectionPaths.set(origin, { ...this.collectionPaths.get(origin), ...links })
  }

  async getVideo(item: MissAVVideoItem | string): Promise<MissAVVideoDetail> {
    const videoCode = typeof item === "string" ? SiteHTML.extractMissAVVideoCode(item) : item.videoCode
    if (!videoCode) throw new Error("缺少 MISSAV 视频标识符。")
    const watchUrl = typeof item === "string" ? this.watchUrl(videoCode) : SiteHTML.normalizeMissAVUrl(item.detailPath)
    const html = await this.fetchHtml(watchUrl)
    return SiteHTML.parseMissAVVideoDetail(html, videoCode, watchUrl)
  }

  watchUrl(videoCode: string): string { return new URL(`${MISSAV_LOCALE}/${SiteHTML.extractMissAVVideoCode(videoCode) || videoCode}`, getMissAVBaseURL()).toString() }
  browseProbeURL(): string { return this.collectionUrl({ collection: "new", page: 1, sort: defaultMissAVCollectionSort("new") }) }
  accessProbeRoutes(): MissAVAccessProbe[] {
    // Check one real entry per group and any routes that actually challenged
    // the user, rather than adding dozens of hidden requests on every check.
    const origin = new URL(getMissAVBaseURL()).origin
    const requests: MissAVSearchParams[] = MISSAV_COLLECTION_GROUPS.map(group => ({ collection: group.defaultCollection, page: 1, sort: defaultMissAVCollectionSort(group.defaultCollection) }))
    for (const [url, params] of this.verificationRequests) if (new URL(url).origin === origin) requests.push(params)
    const seen = new Set<string>()
    const probes: MissAVAccessProbe[] = []
    for (const params of requests) {
      const url = this.collectionUrl(params)
      if (seen.has(url)) continue
      seen.add(url)
      const collection = params.collection!
      probes.push({ collection, title: MISSAV_COLLECTION_OPTIONS.find(option => option.value === collection)!.title, url, params: { ...params } })
    }
    return probes
  }
  accessProbeURL(probe: MissAVAccessProbe): string { return this.collectionUrl(probe.params) }
  playbackHeaders(watchUrl: string, resourceUrl: string): Record<string, string> {
    const localizedWatchURL = resolveMissAVURL(watchUrl)
    return { ...this.requestHeaders(localizedWatchURL), Referer: localizedWatchURL, Origin: new URL(localizedWatchURL).origin, Accept: "*/*" }
  }
  async loadCoverImage(url: string, watchUrl: string): Promise<UIImage | null> { try { const response = await fetch(url, { headers: this.requestHeaders(watchUrl) }); return response.ok ? UIImage.fromData(await response.data()) : null } catch { return null } }

  private collectionUrl(params: MissAVSearchParams): string {
    const query = params.query?.trim()
    const baseURL = getMissAVBaseURL()
    const collection = params.collection || "new"
    const path = query ? `${MISSAV_LOCALE}/search/${encodeURIComponent(query.replace(/\\/g, ""))}` : this.collectionPaths.get(new URL(baseURL).origin)?.[collection] || `${MISSAV_LOCALE}/${collection}`
    const url = new URL(path, baseURL)
    if (params.categoryPath && !query) {
      const categoryURL = new URL(params.categoryPath, baseURL)
      if (categoryURL.origin !== url.origin || !/^\/(?:dm\d+\/)?cn\/(?:actresses|genres|makers)\/[^/]+\/?$/.test(categoryURL.pathname) || /\/ranking\/?$/.test(categoryURL.pathname)) throw new Error("分类链接不属于当前中文站点。")
      url.pathname = categoryURL.pathname
    }
    const directory = isMissAVDirectoryCollection(collection) && !params.categoryPath && !query
    if (!directory && params.filter) url.searchParams.set("filters", params.filter)
    if (!directory && params.sort) url.searchParams.set("sort", params.sort)
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

      if (SiteHTML.classifyCloudflareHTML(html) === "blocked") {
        throw new Error("站点拒绝了当前访问，不是待完成的 Cloudflare 验证。请检查网络或切换访问域名后重试。")
      }
      if (SiteHTML.isCloudflareChallengeHTML(html)) {
        throw new Error("当前线路需要 Cloudflare 验证。请到设置页点击“验证访问线路”，完成验证后再重试。")
      }
      try { await captureCloudflareSession(controller, new URL(url).hostname) } catch { /* Cookie persistence is best-effort; page parsing remains authoritative. */ }
      // A valid MISSAV document is authoritative even if WebKit reports a
      // redirect/load callback as incomplete for this route.
      if (SiteHTML.isLikelyMissAVHTML(html)) {
        this.rememberCollectionRoutes(html, url)
        return html
      }
      const route = new URL(url)
      console.warn("MISSAV page content unavailable", { url, loaded, finished, htmlLength: html?.length || 0 })
      if (!loaded || !finished || !html) throw new MissAVPageContentError(`页面未能载入内容（${route.host}${route.pathname}）。请重试；若仍失败，请在设置页验证访问线路。`)
      throw new MissAVPageContentError(`页面未返回可识别的 MISSAV 内容（${route.host}${route.pathname}）。请在设置页检查访问线路。`)
    } finally {
      controller.dispose()
    }
  }

  private requestHeaders(referer?: string): Record<string, string> { return { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": MISSAV_ACCEPT_LANGUAGE, ...(referer ? { Referer: resolveMissAVURL(referer) } : {}) } }
}

function copySearchPage(value: MissAVSearchPage): MissAVSearchPage {
  return { ...value, items: value.items.map(item => ({ ...item })), ...(value.categories ? { categories: value.categories.map(item => ({ ...item })) } : {}) }
}

export const missavClient = new MissAVClient()
