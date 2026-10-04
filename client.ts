import { fetch } from "scripting"
import { getMissAVBaseURL, MISSAV_ACCEPT_LANGUAGE, MISSAV_LOCALE, resolveMissAVURL } from "./domain"
import { captureCloudflareSession, restoreCloudflareSessionDetailed, type CloudflareRestoreResult } from "./cloudflare-session"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"
import { readCachedListing, writeCachedListing, LISTING_CACHE_FRESH_MS } from "./listing-cache"
import { selectMissAVDOMPage } from "./listing-dom"
import * as SiteHTML from "./html-parser"
import { isMatchingWebViewURL, loadWebViewPage, type WebViewDocument } from "./webview"
import { MissAVRequestScope, isMissAVRequestCancelled } from "./request-scope"
import { withMissAVDeadline } from "./request-deadline"
import { createMissAVDetailTrace, type MissAVDetailTrace } from "./detail-loading"
export { MissAVRequestScope, isMissAVRequestCancelled } from "./request-scope"
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
export type MissAVSearchPage = { items: MissAVVideoItem[]; categories?: MissAVCategoryItem[]; page: number; hasNext: boolean; title: string; cachedAt?: number; stale?: boolean; refreshError?: string }
export type MissAVAccessProbe = { collection: MissAVCollection; title: string; url: string; params: MissAVSearchParams }

const SEARCH_PAGE_CACHE_TTL_MS = 45_000
const MAX_CACHED_SEARCH_PAGES = 24
const RECENT_VIDEO_DETAIL_TTL_MS = 10_000
const MAX_RECENT_VIDEO_DETAILS = 8
type CachedSearchPage = { expiresAt: number; value: MissAVSearchPage }
type PendingSearchPage = { requestId: number; forceRefresh: boolean; promise: Promise<MissAVSearchPage>; scope: MissAVRequestScope; consumers: number; settled: boolean }
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
  private activePageScopes = new Set<MissAVRequestScope>()
  private verificationGate: { promise: Promise<void>; release: () => void; cachedKeys: Set<string> } | null = null
  private recentVideoDetails = new Map<string, { savedAt: number; value: MissAVVideoDetail }>()
  private recentDetailOrigin = ""
  private recentDetailGeneration = 0

  // Cache-only preview for the HomeTab; never starts a verification or HTTP request.
  async readCachedVideoPage(params: MissAVSearchParams): Promise<MissAVSearchPage | null> {
    const url = this.collectionUrl(params)
    const memory = this.searchPageCache.get(url)
    if (memory) return copySearchPage(memory.value)
    const cached = await readCachedListing(url)
    return cached ? { ...cached.value, cachedAt: cached.savedAt, stale: Date.now() - cached.savedAt >= LISTING_CACHE_FRESH_MS } : null
  }

  async searchVideoPage(params: MissAVSearchParams, options: { forceRefresh?: boolean; scope?: MissAVRequestScope; allowStale?: boolean } = {}): Promise<MissAVSearchPage> {
    const caller = options.scope || new MissAVRequestScope()
    await this.waitForVerification(caller)
    caller.assertActive()
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
    if (pending && !pending.scope.cancelled && (!forceRefresh || pending.forceRefresh)) return this.consumeSearchPage(pending, caller, url, options.allowStale)

    const requestId = ++this.searchRequestId
    const scope = new MissAVRequestScope()
    let parseMs = 0, parseCount = 0
    let parseState: "normal" | "cancelled" | "load-error" = "load-error"
    const request = (async () => {
      const persistent = await scope.waitFor(readCachedListing(url))
      scope.assertActive()
      if (!forceRefresh && persistent && Date.now() - persistent.savedAt < LISTING_CACHE_FRESH_MS) {
        parseState = "normal"
        return { ...persistent.value, cachedAt: persistent.savedAt }
      }
      const directory = params.collection && isMissAVDirectoryCollection(params.collection) && !params.categoryPath && !params.query ? params.collection : null
      // WebKit readiness polling can return an identical snapshot repeatedly.
      // Retain only the last snapshot per request, not a growing HTML cache.
      let lastHTML: string | undefined
      let lastPage: MissAVSearchPage | undefined
      const parsePage = (html: string): MissAVSearchPage => {
        scope.assertActive()
        if (html === lastHTML && lastPage) return lastPage
        const started = Date.now()
        try {
          const value = directory
            ? SiteHTML.parseMissAVDirectoryPage(html, page, directory, url)
            : SiteHTML.parseMissAVSearchPage(html, page)
          lastHTML = html; lastPage = value
          return value
        } finally { parseMs += Date.now() - started; parseCount += 1 }
      }
      const isContentReady = (html: string) => {
        const result = parsePage(html)
        return result.items.length > 0 || Boolean(result.categories?.length)
      }
      let compactHTML: string | undefined
      const fetchListing = async (targetURL: string) => {
        compactHTML = undefined
        const html = await this.fetchHtml(targetURL, isContentReady, scope, document => { compactHTML = document.compactHTML })
        // An unfiltered first page must not cache a header-only document as
        // "no content". Searches/filtered/later pages can legitimately be empty.
        if (!params.query && !params.filter && page === 1 && !isContentReady(html)) {
          throw new MissAVPageContentError(`栏目页面未读取到作品或分类（${new URL(targetURL).pathname}）。可能尚未完成加载，请重试；若持续失败，请在设置页检查访问线路。`)
        }
        return html
      }
      let html: string
      try { html = await fetchListing(url) }
      catch (error) {
        if (!(error instanceof MissAVPageContentError) || params.query || params.categoryPath || !params.collection || params.collection === "new") throw error
        if (new URL(getMissAVBaseURL()).origin !== new URL(url).origin) throw error
        // On a cold launch, obtain the current menu from the working Browse
        // entry before retrying a route that returned no usable listing.
        await this.fetchHtml(this.browseProbeURL(), undefined, scope)
        if (new URL(getMissAVBaseURL()).origin !== new URL(url).origin) throw error
        const resolvedURL = this.collectionUrl(params)
        if (resolvedURL === url) throw error
        html = await fetchListing(resolvedURL)
      }
      const value = selectMissAVDOMPage(url, parsePage(html), compactHTML, parsePage)
      parseState = "normal"
      return value
    })()
    const tracked = request.then(async value => {
      scope.assertActive()
      if (new URL(url).origin !== new URL(getMissAVBaseURL()).origin) { scope.cancel(); scope.assertActive() }
      if (this.searchPageRequests.get(url)?.requestId === requestId) {
        if (this.searchPageCache.size >= MAX_CACHED_SEARCH_PAGES) {
          const oldestKey = this.searchPageCache.keys().next().value
          if (oldestKey) this.searchPageCache.delete(oldestKey)
        }
        this.searchPageCache.set(url, { expiresAt: (value.cachedAt || Date.now()) + SEARCH_PAGE_CACHE_TTL_MS, value })
        if (!value.cachedAt) await writeCachedListing(url, value, Date.now())
      }
      scope.assertActive()
      return value
    }).catch(error => {
      parseState = isMissAVRequestCancelled(error) ? "cancelled" : "load-error"
      if (!scope.cancelled && error instanceof Error && error.message.includes("当前线路需要 Cloudflare 验证")) {
        this.verificationRequests.delete(url)
        this.verificationRequests.set(url, { ...params, collection: params.collection || "new" })
      }
      throw error
    }).finally(() => {
      recordMissAVAccessDiagnostic("data-task", url, { state: parseState, phase: "listing-parse", parseMs, parseCount })
      if (this.searchPageRequests.get(url)?.requestId === requestId) this.searchPageRequests.delete(url)
    })
    const task: PendingSearchPage = { requestId, forceRefresh, promise: tracked, scope, consumers: 0, settled: false }
    void tracked.then(() => { task.settled = true }, () => { task.settled = true })
    this.searchPageRequests.set(url, task)
    return this.consumeSearchPage(task, caller, url, options.allowStale)
  }

  private consumeSearchPage(task: PendingSearchPage, caller: MissAVRequestScope, url: string, allowStale = false): Promise<MissAVSearchPage> {
    task.consumers += 1
    return caller.waitFor(task.promise).then(copySearchPage).catch(async error => {
      // Fallback is a per-consumer choice. Verification and recommendations
      // never accept stale content as evidence of online accessibility.
      if (!allowStale || task.scope.cancelled || isMissAVRequestCancelled(error)) throw error
      const cached = await caller.waitFor(readCachedListing(url))
      caller.assertActive()
      if (!cached || new URL(url).origin !== new URL(getMissAVBaseURL()).origin) throw error
      return { ...copySearchPage(cached.value), stale: true, cachedAt: cached.savedAt,
        refreshError: `正在显示本地缓存（${new Date(cached.savedAt).toLocaleString("zh-CN")}）。${error instanceof Error ? error.message : "在线内容暂时无法更新。"}` }
    }).finally(() => {
      task.consumers -= 1
      if (!task.settled && task.consumers === 0) task.scope.cancel()
    })
  }

  private async waitForVerification(scope: MissAVRequestScope): Promise<void> {
    scope.assertActive()
    while (this.verificationGate) { await scope.waitFor(this.verificationGate.promise); scope.assertActive() }
  }

  beginSiteVerification(): () => void {
    if (this.verificationGate) throw new Error("访问线路验证正在进行。")
    this.clearRecentVideoDetails()
    let release!: () => void
    const gate = { promise: new Promise<void>(resolve => { release = resolve }), release: () => release(), cachedKeys: new Set<string>() }
    this.verificationGate = gate
    for (const task of this.searchPageRequests.values()) task.scope.cancel()
    for (const scope of this.activePageScopes) scope.cancel()
    this.searchPageRequests.clear()
    // Keep unrelated successful pages. Only challenged routes are invalidated.
    for (const failedURL of this.verificationRequests.keys()) {
      for (const key of this.searchPageCache.keys()) if (isMatchingWebViewURL(key, failedURL)) this.searchPageCache.delete(key)
    }
    return () => {
      if (this.verificationGate !== gate) return
      // A later interactive check must not let earlier verified pages expire
      // before the post-verification refresh can consume them.
      for (const key of gate.cachedKeys) {
        const cached = this.searchPageCache.get(key)
        if (cached) cached.expiresAt = Date.now() + SEARCH_PAGE_CACHE_TTL_MS
      }
      this.verificationGate = null
      gate.release()
    }
  }

  cacheVerifiedPage(probe: MissAVAccessProbe, document: WebViewDocument | null): boolean {
    if (!document?.html || !isMatchingWebViewURL(document.url, probe.url)
      || new URL(probe.url).origin !== new URL(getMissAVBaseURL()).origin
      || !SiteHTML.isLikelyMissAVHTML(document.html) || SiteHTML.isCloudflareChallengeHTML(document.html)) return false
    const page = Math.max(1, Math.floor(probe.params.page || 1))
    const value = isMissAVDirectoryCollection(probe.collection) && !probe.params.categoryPath && !probe.params.query
      ? SiteHTML.parseMissAVDirectoryPage(document.html, page, probe.collection, probe.url)
      : SiteHTML.parseMissAVSearchPage(document.html, page)
    if (!value.items.length && !value.categories?.length) return false
    this.rememberCollectionRoutes(document.html, probe.url)
    const canonical = this.collectionUrl(probe.params)
    for (const key of new Set([probe.url, canonical])) {
      if (!isMatchingWebViewURL(key, probe.url)) continue
      if (this.searchPageCache.size >= MAX_CACHED_SEARCH_PAGES && !this.searchPageCache.has(key)) this.searchPageCache.delete(this.searchPageCache.keys().next().value!)
      this.searchPageCache.set(key, { expiresAt: Date.now() + SEARCH_PAGE_CACHE_TTL_MS, value: copySearchPage(value) })
      this.verificationGate?.cachedKeys.add(key)
    }
    for (const key of this.verificationRequests.keys()) if (isMatchingWebViewURL(key, probe.url)) this.verificationRequests.delete(key)
    return true
  }

  clearSearchPageCache(): void {
    this.clearRecentVideoDetails()
    this.searchPageCache.clear()
    for (const task of this.searchPageRequests.values()) task.scope.cancel()
    this.searchPageRequests.clear()
    this.searchRequestId += 1
  }

  private clearRecentVideoDetails(): void {
    this.recentVideoDetails.clear()
    this.recentDetailGeneration += 1
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

  async getVideo(item: MissAVVideoItem | string, options: { scope?: MissAVRequestScope; trace?: MissAVDetailTrace; preferRecent?: boolean } = {}): Promise<MissAVVideoDetail> {
    const scope = options.scope || new MissAVRequestScope()
    const trace = options.trace || createMissAVDetailTrace(typeof item === "string" ? this.watchUrl(item) : SiteHTML.normalizeMissAVUrl(item.detailPath))
    try {
      return await withMissAVDeadline(this.loadVideo(item, scope, trace, options.preferRecent === true), 20_000, "获取播放信息超时，请重试；若栏目也无法加载，请先在设置中验证访问线路。", () => { trace.mark("timeout"); scope.cancel() })
    } catch (error) {
      if (!scope.cancelled) trace.mark("failed")
      else if (isMissAVRequestCancelled(error)) trace.mark("cancelled")
      throw error
    }
  }

  private async loadVideo(item: MissAVVideoItem | string, scope: MissAVRequestScope, trace: MissAVDetailTrace, preferRecent: boolean): Promise<MissAVVideoDetail> {
    const videoCode = typeof item === "string" ? SiteHTML.extractMissAVVideoCode(item) : item.videoCode
    if (!videoCode) throw new Error("缺少 MISSAV 视频标识符。")
    const watchUrl = typeof item === "string" ? this.watchUrl(videoCode) : SiteHTML.normalizeMissAVUrl(item.detailPath)
    scope.assertActive()
    const origin = new URL(getMissAVBaseURL()).origin
    if (origin !== this.recentDetailOrigin) { this.clearRecentVideoDetails(); this.recentDetailOrigin = origin }
    if (preferRecent) {
      // Reuse only an immediately preceding successful detail request for
      // playback. Detail-page refreshes always request the live document.
      trace.mark("verification-wait")
      await this.waitForVerification(scope)
      scope.assertActive()
      if (new URL(watchUrl).origin !== new URL(getMissAVBaseURL()).origin) { scope.cancel(); scope.assertActive() }
      const recent = this.recentVideoDetails.get(watchUrl)
      if (recent && Date.now() - recent.savedAt >= 0 && Date.now() - recent.savedAt < RECENT_VIDEO_DETAIL_TTL_MS) {
        trace.mark("detail-parse", { sourceCount: recent.value.sources.length })
        return copyVideoDetail(recent.value)
      }
      this.recentVideoDetails.delete(watchUrl)
    }
    const cacheGeneration = this.recentDetailGeneration
    let lastHTML: string | undefined
    let lastDetail: MissAVVideoDetail | undefined
    let parseMs = 0, parseCount = 0
    const parseDetail = (html: string) => {
      if (html !== lastHTML || !lastDetail) {
        trace.mark("source-parse", { documentChars: html.length })
        const started = Date.now()
        try {
          lastDetail = SiteHTML.parseMissAVVideoDetail(html, videoCode, watchUrl)
          lastHTML = html
        } finally { parseMs += Date.now() - started; parseCount += 1 }
      }
      return lastDetail
    }
    const html = await this.fetchHtml(watchUrl, html => SiteHTML.isLikelyMissAVHTML(html) && parseDetail(html).sources.length > 0, scope, undefined, trace)
    scope.assertActive()
    let state: "normal" | "load-error" = "load-error"
    try {
      trace.mark("detail-parse")
      const value = parseDetail(html)
      if (value.sources.length && cacheGeneration === this.recentDetailGeneration) {
        this.recentVideoDetails.delete(watchUrl)
        if (this.recentVideoDetails.size >= MAX_RECENT_VIDEO_DETAILS) this.recentVideoDetails.delete(this.recentVideoDetails.keys().next().value!)
        this.recentVideoDetails.set(watchUrl, { savedAt: Date.now(), value: copyVideoDetail(value) })
      }
      state = "normal"
      return value
    } finally { recordMissAVAccessDiagnostic("data-task", watchUrl, { state, phase: "detail-parse", parseMs, parseCount }) }
  }

  watchUrl(videoCode: string): string { return new URL(`${MISSAV_LOCALE}/${SiteHTML.extractMissAVVideoCode(videoCode) || videoCode}`, getMissAVBaseURL()).toString() }
  browseProbeURL(): string { return this.collectionUrl({ collection: "new", page: 1, sort: defaultMissAVCollectionSort("new") }) }
  accessProbeRoutes(): MissAVAccessProbe[] {
    // Check one real entry per group and any routes that actually challenged
    // the user, rather than adding dozens of hidden requests on every check.
    const origin = new URL(getMissAVBaseURL()).origin
    const requests: MissAVSearchParams[] = []
    for (const [url, params] of [...this.verificationRequests].reverse()) if (new URL(url).origin === origin) requests.push(params)
    requests.push(...MISSAV_COLLECTION_GROUPS.map(group => ({ collection: group.defaultCollection, page: 1, sort: defaultMissAVCollectionSort(group.defaultCollection) })))
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

  private async fetchHtml(url: string, isContentReady?: (html: string) => boolean, scope = new MissAVRequestScope(), onDocument?: (document: WebViewDocument) => void, trace?: MissAVDetailTrace): Promise<string> {
    // Use the same persistent WebKit session as the verification window.
    // `scripting.fetch` has a separate cookie jar and a manually supplied UA,
    // so Cloudflare can accept the WebView while returning 403 to fetch.
    trace?.mark("verification-wait")
    await this.waitForVerification(scope)
    if (new URL(url).origin !== new URL(getMissAVBaseURL()).origin) scope.cancel()
    scope.assertActive()
    const controller = new WebViewController()
    this.activePageScopes.add(scope)
    let disposed = false
    const dispose = () => { if (!disposed) { disposed = true; controller.dispose() } }
    const removeCancellation = scope.onCancel(dispose)
    const started = Date.now()
    let cookieResult: CloudflareRestoreResult | undefined
    let pageState: "normal" | "challenge" | "blocked" | "unavailable" | "cancelled" | "load-error" = "load-error"
    let loaded = false, finished = false, challengeObserved = false
    let cookieMs = 0, loadMs = 0, captureMs = 0
    let backgroundCapture: Promise<void> | undefined
    try {
      const cookieStarted = Date.now()
      trace?.mark("cookie-restore")
      try { cookieResult = await scope.waitFor(restoreCloudflareSessionDetailed(controller, url, scope)) }
      finally { cookieMs = Date.now() - cookieStarted }
      scope.assertActive()
      const loadStarted = Date.now()
      trace?.mark("page-load")
      let page: Awaited<ReturnType<typeof loadWebViewPage>>
      try { page = await loadWebViewPage(controller, url, undefined, isContentReady, scope, trace ? () => trace.mark("document-read") : undefined) }
      finally { loadMs = Date.now() - loadStarted }
      loaded = page.loaded; finished = page.finished; challengeObserved = Boolean(page.challengeObserved)
      const html = page.html
      scope.assertActive()
      if (new URL(url).origin !== new URL(getMissAVBaseURL()).origin) { scope.cancel(); scope.assertActive() }

      if (SiteHTML.classifyCloudflareHTML(html) === "blocked") {
        pageState = "blocked"
        throw new Error("站点拒绝了当前访问，不是待完成的 Cloudflare 验证。请检查网络或切换访问域名后重试。")
      }
      if (SiteHTML.isCloudflareChallengeHTML(html)) {
        pageState = "challenge"
        throw new Error("当前线路需要 Cloudflare 验证。请到设置页点击“验证访问线路”，完成验证后再重试。")
      }
      // A valid MISSAV document is authoritative even if WebKit reports a
      // redirect/load callback as incomplete for this route.
      if (SiteHTML.isLikelyMissAVHTML(html)) {
        pageState = "normal"
        const captureStarted = Date.now()
        // Return useful content immediately. The bounded cookie task retains
        // the controller until finished and remains cancellable by verification.
        backgroundCapture = Promise.resolve().then(() => captureCloudflareSession(controller, new URL(url).hostname, scope))
          .then(() => {}, () => {})
          .finally(() => { captureMs = Date.now() - captureStarted })
        onDocument?.({ url: page.url || url, html, compactHTML: page.compactHTML })
        this.rememberCollectionRoutes(html, url)
        return html
      }
      const route = new URL(url)
      pageState = "unavailable"
      if (!loaded || !finished || !html) throw new MissAVPageContentError(`页面未能载入内容（${route.host}${route.pathname}）。请重试；若仍失败，请在设置页验证访问线路。`)
      throw new MissAVPageContentError(`页面未返回可识别的 MISSAV 内容（${route.host}${route.pathname}）。请在设置页检查访问线路。`)
    } catch (error) {
      if (isMissAVRequestCancelled(error)) pageState = "cancelled"
      throw error
    } finally {
      recordMissAVAccessDiagnostic("page", url, { state: pageState, cookieState: cookieResult?.state,
        clearance: cookieResult?.clearance, expiresInSeconds: cookieResult?.expiresInSeconds,
        attempted: cookieResult?.attempted, accepted: cookieResult?.accepted, confirmed: cookieResult?.confirmed,
        elapsedMs: Date.now() - started, cookieMs, loadMs, captureMs, loaded, finished, challengeObserved })
      const cleanup = () => { removeCancellation(); this.activePageScopes.delete(scope); dispose() }
      if (backgroundCapture) void backgroundCapture.then(cleanup)
      else cleanup()
    }
  }

  private requestHeaders(referer?: string): Record<string, string> { return { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": MISSAV_ACCEPT_LANGUAGE, ...(referer ? { Referer: resolveMissAVURL(referer) } : {}) } }
}

function copySearchPage(value: MissAVSearchPage): MissAVSearchPage {
  return { ...value, items: value.items.map(item => ({ ...item })), ...(value.categories ? { categories: value.categories.map(item => ({ ...item })) } : {}) }
}

function copyVideoDetail(value: MissAVVideoDetail): MissAVVideoDetail { return { ...value, genres: [...value.genres], sources: value.sources.map(source => ({ ...source })) } }

export const missavClient = new MissAVClient()
