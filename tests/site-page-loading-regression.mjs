import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"

// Execute production modules with only the iOS native bridge mocked.
const modules = new Map()
const scriptingStub = moduleURL('export function fetch() { throw new Error("Unexpected HTTP fetch") }')
function moduleURL(source) { return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}` }
function compile(relative) {
  const url = new URL(relative, import.meta.url)
  if (modules.has(url.href)) return modules.get(url.href)
  const source = stripTypeScriptTypes(readFileSync(url, "utf8"))
    .replace(/\bfrom\s+["']([^"']+)["']/g, (_, specifier) => {
      const dependency = specifier === "scripting" ? scriptingStub : compile(new URL(`${specifier}.ts`, url))
      return `from ${JSON.stringify(dependency)}`
    })
  const compiled = moduleURL(source)
  modules.set(url.href, compiled)
  return compiled
}

const storage = new Map()
const keychain = new Map()
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
globalThis.Keychain = { get: key => keychain.get(key), set: (key, value) => keychain.set(key, value) }
const { loadWebViewPage } = await import(compile("../webview.ts"))
const parser = await import(compile("../html-parser.ts"))
const session = await import(compile("../cloudflare-session.ts"))
const { setMissAVBaseURL } = await import(compile("../domain.ts"))
const { missavClient } = await import(compile("../client.ts"))
const { openMissAVSiteVerification } = await import(compile("../account.ts"))

const nativeTimeout = globalThis.setTimeout
// Accelerate polling only, keeping the production timeout behavior intact.
globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, [250, 300, 500].includes(delay) ? 0 : delay, ...args)
const menu = '<a href="/dm635/ja/release">新作</a><a href="/dm817/ja/uncensored-leak">无码流出</a>'
function listing(code, links = menu) {
  return `<html><body><header>MISSAV ${links}</header><h1>Listing</h1>
    <a href="/ja/${code}"><img src="https://images.example/${code}.jpg" alt="${code} title">2:10:00</a>
    <a href="/ja/${code}">${code} title</a><footer>${"fixture ".repeat(80)}</footer></body></html>`
}
const finalHTML = listing("test-001")
const challenge = '<html><body>Verify you are human<script src="/cdn-cgi/challenge-platform"></script></body></html>'
const empty = '<html><head><title>Loading</title></head><body></body></html>'
function loader(overrides = {}) {
  return { loadURL: async () => false, waitForLoad: async () => false,
    getHTML: async () => null, evaluateJavaScript: async () => null, ...overrides }
}

try {
  let reads = 0
  const redirect = await loadWebViewPage(loader({ getHTML: async () => ++reads < 3 ? empty : finalHTML }), "https://missav.ws/ja/release")
  assert.equal(redirect.html, finalHTML)
  assert.equal(redirect.loaded, false, "Valid redirected HTML is authoritative even after a cancelled callback")
  assert.equal(reads, 3)

  const domFallback = await loadWebViewPage(loader({ loadURL: async () => true,
    waitForLoad: async () => { throw new Error("Navigation cancelled") },
    getHTML: async () => { throw new Error("Document not ready") },
    evaluateJavaScript: async script => { assert.match(script, /return document\.documentElement/); return finalHTML },
  }), "https://missav.ws/ja/new")
  assert.equal(domFallback.html, finalHTML)
  reads = 0
  assert.equal((await loadWebViewPage(loader({ getHTML: async () => { reads++; return empty } }), "https://missav.ws/ja/new")).html, null)
  assert.equal(reads, 10, "Blank scaffolds must stop at the bounded retry limit")
  await assert.rejects(loadWebViewPage(loader({ loadURL: async () => { throw new Error("Native load failed") } }), "https://missav.ws/ja/new"), /Native load failed/)

  let resolveLoad
  let callsAfterTimeout = 0
  const pendingLoad = loadWebViewPage(loader({ loadURL: () => new Promise(resolve => { resolveLoad = resolve }),
    getHTML: async () => { callsAfterTimeout++; return finalHTML },
  }), "https://missav.ws/ja/new", 15)
  await assert.rejects(pendingLoad, /网页加载超时/)
  resolveLoad(true)
  await new Promise(resolve => nativeTimeout(resolve, 5))
  assert.equal(callsAfterTimeout, 0, "Timed-out tasks must not read a disposed native controller")

  const routes = parser.parseMissAVCollectionLinks(`${menu}
    <a href="/ja/release?sort=views">bare</a>
    <a href="/dm12/en/fc2">wrong language</a>
    <a href="https://missav.ai/dm99/ja/fc2">wrong domain</a>
    <a href="/dm45/ja/today-hot?sort=today_views&amp;page=2#menu">hot</a>
    <a href="javascript:alert(1)">action</a>`, "https://missav.ws/ja/new")
  assert.deepEqual(routes, { release: "/dm635/ja/release", "uncensored-leak": "/dm817/ja/uncensored-leak", "today-hot": "/dm45/ja/today-hot" })

  const cookie = (value, domain = ".missav.ws", expiresDate = new Date(Date.now() + 60_000)) => ({ name: "cf_clearance", value, domain, expiresDate })
  let liveCookies = [cookie("fixture-old")]
  const writes = []
  const jar = { getAllCookies: async () => liveCookies, setCookie: async value => writes.push(value) }
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
    async setCookie(value) { sharedCookies = [value] }
    async loadURL(url) { requests.push(url); this.html = responseFor(new URL(url)); return Boolean(this.html) }
    async waitForLoad() { return Boolean(this.html) }
    async getHTML() { return this.html }
    async evaluateJavaScript() { return this.html }
    present() { modalCount++; this.html = modalContent; return new Promise(resolve => { this.close = resolve }) }
    dismiss() { this.close?.() }
    dispose() { this.disposed = true }
  }
  globalThis.WebViewController = MockWebView
  keychain.clear()
  responseFor = url => {
    if (url.pathname === "/ja/release") return null
    if (url.pathname === "/ja/new") return finalHTML
    if (url.pathname === "/dm635/ja/release") return listing("release-002")
    if (url.pathname === "/dm817/ja/uncensored-leak") return listing("leak-003")
    throw new Error(`Unexpected route: ${url.pathname}`)
  }
  const release = await missavClient.searchVideoPage({ collection: "release", page: 2, sort: "released_at", filter: "individual" })
  assert.equal(release.items[0].videoCode, "release-002")
  assert.deepEqual(requests.map(value => new URL(value).pathname), ["/ja/release", "/ja/new", "/dm635/ja/release"])
  const recoveredURL = new URL(requests.at(-1))
  assert.equal(recoveredURL.searchParams.get("page"), "2")
  assert.equal(recoveredURL.searchParams.get("sort"), "released_at")
  assert.equal(recoveredURL.searchParams.get("filters"), "individual")
  const leak = await missavClient.searchVideoPage({ collection: "uncensored-leak" })
  assert.equal(leak.items[0].videoCode, "leak-003")
  assert.equal(new URL(requests.at(-1)).pathname, "/dm817/ja/uncensored-leak")
  assert.equal(modalCount, 0, "Browse requests never open verification UI")
  assert.ok(controllers.every(controller => controller.disposed))

  setMissAVBaseURL("https://missav.ai/")
  const aiMenu = menu.replace("dm635", "dm111").replace("dm817", "dm222")
  requests.length = 0
  responseFor = url => url.pathname === "/ja/release" ? null : listing("ai-004", aiMenu)
  await missavClient.searchVideoPage({ collection: "release" })
  assert.deepEqual(requests.map(value => new URL(value).pathname), ["/ja/release", "/ja/new", "/dm111/ja/release"])
  assert.ok(requests.every(value => new URL(value).hostname === "missav.ai"))

  setMissAVBaseURL("https://missav.ws/")
  requests.length = 0
  responseFor = () => challenge
  await assert.rejects(missavClient.searchVideoPage({ collection: "uncensored-leak" }, { forceRefresh: true }), /当前线路需要 Cloudflare 验证/)
  assert.equal(requests.length, 1, "Real challenges cannot be retried as route-discovery failures")
  assert.equal(modalCount, 0)

  requests.length = 0
  responseFor = () => { setMissAVBaseURL("https://missav.ai/"); return null }
  await assert.rejects(missavClient.searchVideoPage({ collection: "release" }, { forceRefresh: true }), /页面未能载入内容/)
  assert.equal(requests.length, 1, "A domain switch must cancel route recovery for the old domain")
  setMissAVBaseURL("https://missav.ws/")

  // Settings refreshes the next probe's dynamic path after reading the first menu.
  missavClient.collectionPaths.clear()
  requests.length = 0
  const probeMenu = menu + '<a href="/dm333/ja/fc2">FC2</a>'
  sharedCookies = [cookie("verified-live")]
  responseFor = url => listing("verified-005", probeMenu)
  assert.equal((await openMissAVSiteVerification()).status, "accessible")
  assert.equal(requests.length, 7)
  assert.equal(new URL(requests[1]).pathname, "/dm635/ja/release")
  assert.equal(new URL(requests[2]).pathname, "/dm817/ja/uncensored-leak")
  assert.equal(new URL(requests[3]).pathname, "/dm333/ja/fc2")
  assert.ok(controllers.every(controller => controller.disposed))
  sharedCookies = []
  await session.restoreCloudflareSession(jar, "missav.ws")
  assert.equal(writes.pop().value, "verified-live", "Settings must persist already accessible native sessions as well")

  let needsChallenge = true
  const nativePresent = MockWebView.prototype.present
  MockWebView.prototype.present = function() {
    needsChallenge = false
    return nativePresent.call(this)
  }
  responseFor = url => url.pathname.endsWith("/release") && needsChallenge ? challenge : listing("verified-006", probeMenu)
  modalContent = listing("verified-006", probeMenu)
  requests.length = 0
  assert.equal((await openMissAVSiteVerification()).status, "accessible")
  assert.equal(modalCount, 1, "A Settings challenge presents the exact route, then auto dismisses on real listing content")
  assert.equal(requests.length, 8, "One visible successful route must still check all remaining probes")

  // A failed later probe must not read the preceding controller's listing.
  modalCount = 0
  responseFor = url => url.pathname.endsWith("/new") ? finalHTML : null
  modalContent = null
  MockWebView.prototype.present = function() { modalCount++; return Promise.resolve() }
  const unavailable = await openMissAVSiteVerification()
  assert.equal(unavailable.status, "unavailable")
  assert.equal(unavailable.probe.collection, "release")
  assert.equal(modalCount, 1)
  assert.ok(controllers.every(controller => controller.disposed))
  console.log("MISSAV native page loading, dynamic routes, live cookies and verification regressions passed")
} finally {
  globalThis.setTimeout = nativeTimeout
}
