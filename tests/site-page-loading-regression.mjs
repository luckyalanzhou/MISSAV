import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

const storage = new Map()
const keychain = new Map()
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
globalThis.Keychain = { get: key => keychain.get(key), set: (key, value) => keychain.set(key, value), remove: key => keychain.delete(key) }
const { loadWebViewPage } = await import(compile("../webview.ts"))
const parser = await import(compile("../html-parser.ts"))
const session = await import(compile("../cloudflare-session.ts"))
const { setMissAVBaseURL, getMissAVLandingURL, resolveMissAVURL, MISSAV_ACCEPT_LANGUAGE, MISSAV_LOCALE } = await import(compile("../domain.ts"))
const { missavClient } = await import(compile("../client.ts"))
const { MISSAV_COLLECTION_OPTIONS, isMissAVDirectoryCollection } = await import(compile("../collections.ts"))
const { openMissAVSiteVerification } = await import(compile("../account.ts"))

const nativeTimeout = globalThis.setTimeout
// Accelerate polling only, keeping the production timeout behavior intact.
globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, [250, 300, 500].includes(delay) ? 0 : delay, ...args)
const menu = '<a href="/dm635/cn/release">新作</a><a href="/dm817/cn/uncensored-leak">无码流出</a>'
function listing(code, links = menu) {
  return `<html><body><header>MISSAV ${links}</header><h1>Listing</h1>
    <a href="/cn/${code}"><img src="https://images.example/${code}.jpg" alt="${code} title">2:10:00</a>
    <a href="/cn/${code}">${code} title</a><footer>${"fixture ".repeat(80)}</footer></body></html>`
}
const finalHTML = listing("test-001")
const challenge = '<html><body>Verify you are human<script src="/cdn-cgi/challenge-platform"></script></body></html>'
const empty = '<html><head><title>Loading</title></head><body></body></html>'
function loader(overrides = {}) {
  let currentURL = "about:blank"
  const controller = { loadURL: async () => false, waitForLoad: async () => false,
    getHTML: async () => null, ...overrides }
  const load = controller.loadURL
  controller.loadURL = async url => { currentURL = url; return load(url) }
  controller.evaluateJavaScript ??= async () => ({ url: currentURL, html: await controller.getHTML() })
  return controller
}

try {
  let reads = 0
  const redirect = await loadWebViewPage(loader({ getHTML: async () => ++reads < 3 ? empty : finalHTML }), "https://missav.ws/cn/release")
  assert.equal(redirect.html, finalHTML)
  assert.equal(redirect.loaded, false, "Valid redirected HTML is authoritative even after a cancelled callback")
  assert.equal(reads, 3)

  const domFallback = await loadWebViewPage(loader({ loadURL: async () => true,
    waitForLoad: async () => { throw new Error("Navigation cancelled") },
    getHTML: async () => { throw new Error("Document not ready") },
    evaluateJavaScript: async script => { assert.match(script, /url: window\.location\.href/); return { url: "https://missav.ws/cn/new", html: finalHTML } },
  }), "https://missav.ws/cn/new")
  assert.equal(domFallback.html, finalHTML)
  reads = 0
  assert.equal((await loadWebViewPage(loader({ getHTML: async () => { reads++; return empty } }), "https://missav.ws/cn/new")).html, null)
  assert.equal(reads, 10, "Blank scaffolds must stop at the bounded retry limit")
  await assert.rejects(loadWebViewPage(loader({ loadURL: async () => { throw new Error("Native load failed") } }), "https://missav.ws/cn/new"), /Native load failed/)

  let resolveLoad
  let callsAfterTimeout = 0
  const pendingLoad = loadWebViewPage(loader({ loadURL: () => new Promise(resolve => { resolveLoad = resolve }),
    getHTML: async () => { callsAfterTimeout++; return finalHTML },
  }), "https://missav.ws/cn/new", 15)
  await assert.rejects(pendingLoad, /网页加载超时/)
  resolveLoad(true)
  await new Promise(resolve => nativeTimeout(resolve, 5))
  assert.equal(callsAfterTimeout, 0, "Timed-out tasks must not read a disposed native controller")

  const routes = parser.parseMissAVCollectionLinks(`${menu}
    <a href="/cn/release?sort=views">bare</a>
    <a href="/dm12/en/fc2">wrong language</a>
    <a href="/dm13/ja/fc2">old Japanese language</a>
    <a href="https://missav.ai/dm99/cn/fc2">wrong domain</a>
    <a href="/dm45/cn/today-hot?sort=today_views&amp;page=2#menu">hot</a>
    <a href="javascript:alert(1)">action</a>`, "https://missav.ws/cn/new")
  assert.deepEqual(routes, { release: "/dm635/cn/release", "uncensored-leak": "/dm817/cn/uncensored-leak", "today-hot": "/dm45/cn/today-hot" })

  assert.equal(MISSAV_LOCALE, "cn")
  for (const baseURL of ["https://missav.ws/", "https://missav.ai/"]) {
    setMissAVBaseURL(baseURL)
    assert.equal(getMissAVLandingURL(), `${baseURL}cn/`)
    assert.equal(getMissAVLandingURL(baseURL), `${baseURL}cn/`)
    assert.equal(missavClient.watchUrl("ABC-123"), `${baseURL}cn/abc-123`)
    for (const oldLocale of ["ja", "en", "cn", "ko", "ms", "th", "de", "fr", "vi", "id", "fil", "pt"]) {
      const oldURL = `https://missav.ws/dm55/${oldLocale}/ABC-123?quality=1080#play`
      const normalizedURL = `${baseURL}dm55/cn/ABC-123?quality=1080#play`
      assert.equal(resolveMissAVURL(oldURL), normalizedURL)
      const headers = missavClient.playbackHeaders(oldURL, "https://cdn.example/ja/video.m3u8?token=fixture")
      assert.equal(headers.Referer, normalizedURL)
      assert.equal(headers.Origin, new URL(baseURL).origin)
      assert.equal(headers["Accept-Language"], MISSAV_ACCEPT_LANGUAGE)
    }
    assert.equal(resolveMissAVURL("https://cdn.example/ja/video.m3u8?token=fixture"), "https://cdn.example/ja/video.m3u8?token=fixture")
    assert.equal(resolveMissAVURL("/covers/abc.jpg"), `${baseURL}covers/abc.jpg`)
  }
  setMissAVBaseURL("https://missav.ws/")
  const settingsSource = readFileSync(new URL("../page/settings.tsx", import.meta.url), "utf8")
  assert.match(settingsSource, /Safari\.openURL\(getMissAVLandingURL\(domain\)\)/)
  const accountSource = readFileSync(new URL("../account.ts", import.meta.url), "utf8")
  for (const path of ["saved", "login", "api/login"]) {
    assert.ok(accountSource.includes(`/${"${MISSAV_LOCALE}"}/${path}`), `${path} must use the shared locale`)
  }

  const cookie = (value, domain = ".missav.ws", expiresDate = new Date(Date.now() + 60_000)) => ({ name: "cf_clearance", value, domain, expiresDate })
  let liveCookies = [cookie("fixture-old")]
  const writes = []
  const jar = { getAllCookies: async () => liveCookies, setCookie: async value => { writes.push(value); liveCookies = [value]; return true } }
  await session.captureCloudflareSession(jar, "missav.ws")
  liveCookies = [cookie("fixture-fresh")]
  assert.equal(await session.restoreCloudflareSession(jar, "missav.ws"), 1)
  assert.equal(writes.length, 0, "Live shared clearance must never be replaced by a saved older token")
  await session.captureCloudflareSession(jar, "missav.ws")
  liveCookies = [cookie("wrong-host", ".missav.ai")]
  await session.restoreCloudflareSession(jar, "missav.ws")
  assert.equal(writes.pop().value, "fixture-fresh", "A different domain cannot provide this host's clearance")
  liveCookies = [cookie("expired", ".missav.ws", new Date(0))]
  await session.restoreCloudflareSession(jar, "missav.ws")
  assert.equal(writes.pop().value, "fixture-fresh")
  liveCookies = []
  await session.restoreCloudflareSession(jar, "missav.ai")
  assert.equal(writes.length, 0, "No cross-domain restoration")
  await session.restoreCloudflareSession({ getAllCookies: async () => { throw new Error("Cookie store unavailable") }, setCookie: jar.setCookie }, "missav.ws")
  assert.equal(writes.pop().value, "fixture-fresh", "Saved cookies remain a fallback when the native cookie store cannot be read")

  const requests = []
  const controllers = []
  let responseFor = () => finalHTML
  let modalCount = 0
  let modalContent = finalHTML
  let sharedCookies = []
  class MockWebView {
    html = null
    disposed = false
    constructor() { controllers.push(this) }
    async getAllCookies() { return sharedCookies }
    async setCookie(value) { sharedCookies = [value]; return true }
    async loadURL(url) { this.url = url; requests.push(url); this.html = responseFor(new URL(url)); return Boolean(this.html) }
    async waitForLoad() { return Boolean(this.html) }
    async getHTML() { return this.html }
    async evaluateJavaScript() { return { url: this.url, html: await this.getHTML() } }
    present() { modalCount++; this.html = modalContent; return new Promise(resolve => { this.close = resolve }) }
    dismiss() { this.close?.() }
    dispose() { this.disposed = true }
  }
  globalThis.WebViewController = MockWebView
  keychain.clear()
  responseFor = url => {
    if (url.pathname === "/cn/release") return null
    if (url.pathname === "/cn/new") return finalHTML
    if (url.pathname === "/dm635/cn/release") return listing("release-002")
    if (url.pathname === "/dm817/cn/uncensored-leak") return listing("leak-003")
    throw new Error(`Unexpected route: ${url.pathname}`)
  }
  const release = await missavClient.searchVideoPage({ collection: "release", page: 2, sort: "released_at", filter: "individual" })
  assert.equal(release.items[0].videoCode, "release-002")
  assert.deepEqual(requests.map(value => new URL(value).pathname), ["/cn/release", "/cn/new", "/dm635/cn/release"])
  const recoveredURL = new URL(requests.at(-1))
  assert.equal(recoveredURL.searchParams.get("page"), "2")
  assert.equal(recoveredURL.searchParams.get("sort"), "released_at")
  assert.equal(recoveredURL.searchParams.get("filters"), "individual")
  const leak = await missavClient.searchVideoPage({ collection: "uncensored-leak" })
  assert.equal(leak.items[0].videoCode, "leak-003")
  assert.equal(new URL(requests.at(-1)).pathname, "/dm817/cn/uncensored-leak")
  assert.equal(modalCount, 0, "Browse requests never open verification UI")
  assert.ok(controllers.every(controller => controller.disposed))

  // Playback resolves a fresh Chinese detail even for items saved under ja/en.
  requests.length = 0
  const mediaURL = "https://cdn.example/ja/1080p/video.m3u8?token=fixture"
  responseFor = () => `<html><head><meta property="og:title" content="MISSAV 中文标题"></head><body><video src="${mediaURL}"></video>${"fixture ".repeat(80)}</body></html>`
  const detail = await missavClient.getVideo({ videoCode: "ABC-123", title: "old title", detailPath: "https://missav.ws/dm55/ja/ABC-123", coverUrl: "" })
  assert.equal(requests[0], "https://missav.ws/dm55/cn/ABC-123")
  assert.equal(detail.watchUrl, "https://missav.ws/dm55/cn/ABC-123")
  assert.equal(detail.sources[0].url, mediaURL, "CDN stream paths and signed query parameters must not be rewritten")

  setMissAVBaseURL("https://missav.ai/")
  const aiMenu = menu.replace("dm635", "dm111").replace("dm817", "dm222")
  requests.length = 0
  responseFor = url => url.pathname === "/cn/release" ? null : listing("ai-004", aiMenu)
  await missavClient.searchVideoPage({ collection: "release" })
  assert.deepEqual(requests.map(value => new URL(value).pathname), ["/cn/release", "/cn/new", "/dm111/cn/release"])
  assert.ok(requests.every(value => new URL(value).hostname === "missav.ai"))

  setMissAVBaseURL("https://missav.ws/")
  requests.length = 0
  responseFor = () => challenge
  await assert.rejects(missavClient.searchVideoPage({ collection: "uncensored-leak" }, { forceRefresh: true }), /当前线路需要 Cloudflare 验证/)
  assert.equal(requests.length, 1, "Real challenges cannot be retried as route-discovery failures")
  assert.equal(modalCount, 0)

  requests.length = 0
  responseFor = () => { setMissAVBaseURL("https://missav.ai/"); return null }
  await assert.rejects(missavClient.searchVideoPage({ collection: "release" }, { forceRefresh: true }), /页面请求已取消/)
  assert.equal(requests.length, 1, "A domain switch must cancel route recovery for the old domain")
  setMissAVBaseURL("https://missav.ws/")

  // Settings refreshes the next probe's dynamic path after reading the first menu.
  missavClient.collectionPaths.clear()
  missavClient.clearVerificationCollections()
  requests.length = 0
  const probeMenu = menu + '<a href="/dm333/cn/fc2">FC2</a>'
  sharedCookies = [cookie("verified-live")]
  responseFor = url => listing("verified-005", probeMenu)
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: false })
  assert.equal(requests.length, 5)
  assert.ok(requests.every(value => /^\/(?:dm\d+\/)?cn\//.test(new URL(value).pathname)), "Every Settings verification probe uses cn")
  assert.deepEqual(requests.map(value => new URL(value).pathname), ["/cn/chinese-subtitle", "/cn/new", "/cn/siro", "/dm817/cn/uncensored-leak", "/cn/madou"])
  assert.ok(controllers.every(controller => controller.disposed))
  sharedCookies = []
  liveCookies = []
  await session.restoreCloudflareSession(jar, "missav.ws")
  assert.equal(writes.pop().value, "verified-live", "Settings must persist already accessible native sessions as well")

  let needsChallenge = true
  responseFor = () => challenge
  await assert.rejects(missavClient.searchVideoPage({ collection: "release" }, { forceRefresh: true }), /Cloudflare/)
  const nativePresent = MockWebView.prototype.present
  MockWebView.prototype.present = function() {
    needsChallenge = false
    return nativePresent.call(this)
  }
  responseFor = url => url.pathname.endsWith("/release") && needsChallenge ? challenge : listing("verified-006", probeMenu)
  modalContent = listing("verified-006", probeMenu)
  requests.length = 0
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: true })
  assert.equal(modalCount, 1, "A Settings challenge presents the exact route, then auto dismisses on real listing content")
  assert.equal(requests.length, 7, "Check five group entries and the recently challenged subcategory, with one visible reload")
  assert.equal(missavClient.accessProbeRoutes().length, 5, "Successful verification clears remembered challenge routes")

  // A window opened for a blank document isn't proof of a Cloudflare challenge.
  let blankDocument = true
  modalCount = 0
  requests.length = 0
  responseFor = () => blankDocument ? null : listing("recovered-007", probeMenu)
  modalContent = listing("recovered-007", probeMenu)
  MockWebView.prototype.present = function() {
    blankDocument = false
    return nativePresent.call(this)
  }
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: false })
  assert.equal(modalCount, 1)
  assert.equal(requests.length, 6)

  // Also record challenges that appear only after the window becomes visible.
  blankDocument = true
  modalCount = 0
  let visibleReads = 0
  const nativeGetHTML = MockWebView.prototype.getHTML
  MockWebView.prototype.getHTML = async function() {
    if (this.close) this.html = ++visibleReads === 1 ? challenge : listing("foreground-008", probeMenu)
    return nativeGetHTML.call(this)
  }
  responseFor = () => blankDocument ? null : listing("foreground-008", probeMenu)
  modalContent = challenge
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: true })
  assert.equal(modalCount, 1)
  assert.ok(visibleReads >= 2)
  MockWebView.prototype.getHTML = nativeGetHTML

  // Closing while a challenge is still present must never report completion.
  responseFor = () => challenge
  modalContent = challenge
  MockWebView.prototype.present = function() { modalCount++; this.html = modalContent; return Promise.resolve() }
  const incomplete = await openMissAVSiteVerification()
  assert.equal(incomplete.status, "incomplete")
  assert.equal(incomplete.challengeCompleted, undefined)

  // A failed later probe must not read the preceding controller's listing.
  modalCount = 0
  responseFor = url => url.pathname.endsWith("/chinese-subtitle") ? finalHTML : null
  modalContent = null
  MockWebView.prototype.present = function() { modalCount++; return Promise.resolve() }
  const unavailable = await openMissAVSiteVerification()
  assert.equal(unavailable.status, "unavailable")
  assert.equal(unavailable.probe.collection, "new")
  assert.equal(modalCount, 1)
  assert.ok(controllers.every(controller => controller.disposed))
  // Every video subcategory uses its own menu URL, retaining Chinese versions.
  modalCount = 0
  const siteMenu = MISSAV_COLLECTION_OPTIONS.map((option, index) => `<a href="/dm${100 + index}/cn/${option.value}">${option.title}</a>`).join("")
  missavClient.rememberCollectionRoutes(listing("bootstrap-000", siteMenu), "https://missav.ws/cn/new")
  responseFor = url => {
    const index = MISSAV_COLLECTION_OPTIONS.findIndex(option => url.pathname.endsWith(`/cn/${option.value}`))
    assert.ok(index >= 0)
    return listing(`fixture-${index}-chinese-subtitle`, siteMenu)
  }
  for (const [index, option] of MISSAV_COLLECTION_OPTIONS.entries()) {
    if (isMissAVDirectoryCollection(option.value)) continue
    const result = await missavClient.searchVideoPage({ collection: option.value, page: 2, filter: "individual", sort: "views" }, { forceRefresh: true })
    const route = new URL(requests.at(-1))
    assert.equal(route.pathname, `/dm${100 + index}/cn/${option.value}`)
    assert.equal(route.searchParams.get("page"), "2")
    assert.equal(route.searchParams.get("filters"), "individual")
    assert.equal(route.searchParams.get("sort"), "views")
    assert.deepEqual(result.items.map(item => item.videoCode), [`fixture-${index}-chinese-subtitle`])
    assert.equal(result.items[0].badge, "中文字幕")
    assert.match(result.items[0].detailPath, /\/cn\/fixture-\d+-chinese-subtitle$/)
  }
  assert.equal(modalCount, 0, "Browsing any subcategory cannot present verification UI")

  // Native directory pages exclude menu links and open actual leaf listings.
  for (const collection of ["actresses", "actresses/ranking", "genres", "makers"]) {
    const kind = collection === "actresses/ranking" ? "actresses" : collection
    responseFor = () => `<html><header>MISSAV<a href="/cn/${kind}/menu-only">Menu</a></header><h1>分类目录</h1>
      <a href="/dm22/cn/${kind}/example"><img src="/cover.jpg" alt="分类测试">分类测试</a>
      <a href="/dm22/cn/${kind}/example">duplicate</a><a href="/cn/${kind}/ranking">ranking</a>
      <a href="https://other.example/cn/${kind}/external">external</a>
      <a href="/cn/${collection}?page=2">下一页</a>${"fixture ".repeat(80)}<footer></footer></html>`
    const directory = await missavClient.searchVideoPage({ collection, sort: "views", filter: "multiple" }, { forceRefresh: true })
    assert.deepEqual(directory.items, [])
    assert.deepEqual(directory.categories, [{ title: "分类测试", path: `/dm22/cn/${kind}/example`, coverUrl: "https://missav.ws/cover.jpg" }])
    assert.equal(directory.hasNext, true)
    assert.equal(new URL(requests.at(-1)).searchParams.get("sort"), null)
    responseFor = () => listing("category-001", siteMenu)
    const leaf = await missavClient.searchVideoPage({ collection, categoryPath: directory.categories[0].path, page: 2, filter: "chinese-subtitle", sort: "saved" }, { forceRefresh: true })
    assert.equal(leaf.items[0].videoCode, "category-001")
    const route = new URL(requests.at(-1))
    assert.equal(route.pathname, `/dm22/cn/${kind}/example`)
    assert.equal(route.searchParams.get("filters"), "chinese-subtitle")
    assert.equal(route.searchParams.get("sort"), "saved")
    assert.equal(route.searchParams.get("page"), "2")
  }
  // A challenged category leaf must not be "verified" using its directory root.
  responseFor = () => challenge
  await assert.rejects(missavClient.searchVideoPage({ collection: "genres", categoryPath: "/dm22/cn/genres/example", page: 2, filter: "multiple", sort: "views" }, { forceRefresh: true }), /Cloudflare/)
  requests.length = 0
  responseFor = () => listing("verified-leaf-001", siteMenu)
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: false })
  assert.equal(requests.length, 6)
  const verifiedLeafURL = new URL(requests[0])
  assert.equal(verifiedLeafURL.pathname, "/dm22/cn/genres/example")
  assert.equal(verifiedLeafURL.searchParams.get("page"), "2")
  assert.equal(verifiedLeafURL.searchParams.get("filters"), "multiple")
  assert.equal(verifiedLeafURL.searchParams.get("sort"), "views")
  assert.equal(modalCount, 0, "An accessible category leaf is a video listing, not an empty directory")
  assert.ok(controllers.every(controller => controller.disposed))

  // Production page requests and Settings both accept real content with passive JSD.
  responseFor = () => listing("jsd-001", siteMenu).replace("</body>", '<script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script></body>')
  const jsdPage = await missavClient.searchVideoPage({ collection: "new" }, { forceRefresh: true })
  assert.equal(jsdPage.items[0].videoCode, "jsd-001")
  modalCount = 0
  assert.deepEqual(await openMissAVSiteVerification(), { status: "accessible", challengeCompleted: false })
  assert.equal(modalCount, 0, "Background detection scripts cannot open a verification window")

  const denied = '<html><title>Attention Required! | Cloudflare</title><body>Sorry, you have been blocked. Cloudflare Ray ID: fixture</body></html>'
  responseFor = () => denied
  await assert.rejects(missavClient.searchVideoPage({ collection: "new" }, { forceRefresh: true }), /站点拒绝了当前访问/)
  const deniedVerification = await openMissAVSiteVerification()
  assert.equal(deniedVerification.status, "blocked")
  assert.equal(modalCount, 0, "Access denied is not a solvable challenge")

  // After manual dismissal, a different domain's listing cannot produce success.
  responseFor = () => challenge
  MockWebView.prototype.present = function() {
    modalCount++
    this.url = "https://other.example/cn/new"
    this.html = finalHTML
    return Promise.resolve()
  }
  assert.equal((await openMissAVSiteVerification()).status, "unavailable")
  // Existing pure parser/session/account tests use only Script.exit reporting.
  // Execute them here without pretending to run the native Scripting host.
  await import(compile("../tests/client-parser-regression.ts"))
  await import(compile("../tests/cloudflare-session-regression.ts"))
  await import(compile("../tests/account-auth-regression.ts"))
  console.log("MISSAV native page loading, dynamic routes, live cookies and verification regressions passed")
} finally {
  globalThis.setTimeout = nativeTimeout
}
