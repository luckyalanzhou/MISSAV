import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

const storage = new Map()
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
globalThis.Keychain = { get: () => null, set: () => {} }
const parser = await import(compile("../html-parser.ts"))
const { missavClient } = await import(compile("../client.ts"))
const { loadWebViewPage } = await import(compile("../webview.ts"))
const { setMissAVBaseURL } = await import(compile("../domain.ts"))

// Observed detail-link formats on the Chinese website. Titles/covers are
// synthetic; the three adjacent anchors mirror the inspected card structure.
const examples = [
  ["tokyohot", ["n1854", "lb0029", "ka056"]],
  ["1pondo", ["092426_001", "pondo-092426_001"]],
  ["caribbeancom", ["092726-001", "caribbeancom-092326-001"]],
  ["10musume", ["092626_01", "musume-092526_01"]],
  ["pacopacomama", ["092626_100", "pacopacomama-092226_100"]],
  ["gachinco", ["gachip140", "gachi1083"]],
]
function card(code, prefix = "/cn/") {
  const path = `${prefix}${code}`
  return `<div class="card"><div>
    <a href="${path}"><video data-src="https://images.example/${code}/preview.mp4"></video><img data-src="https://images.example/${code}/cover.jpg" alt="${code} sample title"></a>
    <a href="${path}"><span>1:01:47</span></a></div>
    <a class="text-secondary" href="${path}">${code} sample title</a></div>`
}
function listing(codes) {
  return `<html><head><title>MISSAV</title></head><body><h1>Listing</h1>${codes.map(code => card(code)).join("")}
    <a href="?page=2">Next</a><footer>${"fixture ".repeat(80)}</footer>
    <script src="/cdn-cgi/challenge-platform/scripts/jsd/api.js"></script></body></html>`
}

for (const [collection, codes] of examples) {
  const html = listing(codes)
  assert.deepEqual(parser.parseMissAVVideoItems(html).map(item => item.videoCode), codes, `${collection}: all real code formats must survive parsing`)
  assert.equal(parser.isLikelyMissAVListingHTML(html), true)
  assert.equal(parser.classifyCloudflareHTML(html), "none")
  const repeated = parser.parseMissAVVideoItems(html + codes.map(code => card(code)).join(""))
  assert.equal(repeated.length, codes.length, "Repeated card links must not duplicate works")
}

const requests = []
let disposed = 0
const shell = `<html><head><title>MISSAV</title></head><body><header>MISSAV</header><h1>Listing</h1><footer>${"fixture ".repeat(80)}</footer></body></html>`
let shellOnly = false
let delayedReads = 0
class MockWebView {
  async getAllCookies() { return [] }
  async loadURL(url) {
    this.url = url
    requests.push(url)
    const route = new URL(url).pathname.split("/").at(-1)
    this.html = listing(examples.find(([collection]) => collection === route)[1])
    return true
  }
  async waitForLoad() { return true }
  async evaluateJavaScript() { return { url: this.url, html: this.html } }
  present() { throw new Error("Browse must not open verification UI") }
  dispose() { disposed++ }
}
globalThis.WebViewController = MockWebView

for (const baseURL of ["https://missav.ws/", "https://missav.ai/"]) {
  setMissAVBaseURL(baseURL)
  const client = new missavClient.constructor()
  for (const [collection, codes] of examples) {
    for (const page of [1, 2]) {
      const result = await client.searchVideoPage({ collection, page, sort: "released_at" })
      assert.deepEqual(result.items.map(item => item.videoCode), codes)
      assert.ok(result.items.every(item => item.duration === "1:01:47"))
      assert.ok(result.items.every(item => item.detailPath === `${baseURL}cn/${item.videoCode}`))
      const url = new URL(requests.at(-1))
      assert.equal(url.pathname, `/cn/${collection}`)
      assert.equal(url.searchParams.get("page"), page === 1 ? null : "2")
      assert.equal(url.searchParams.get("sort"), "released_at")
      assert.equal(client.watchUrl(codes[0]), `${baseURL}cn/${codes[0]}`)
    }
  }
}
assert.equal(disposed, 24)

// Caribbeancom already uses hyphenated codes: also cover the separate risk
// of reading a normal header before its cards have appeared in the WebView.
const nativeTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 300 ? 0 : delay, ...args)
try {
  let reads = 0
  let navigations = 0
  const delayed = await loadWebViewPage({
    loadURL: async () => { navigations++; return true },
    waitForLoad: async () => true,
    evaluateJavaScript: async () => ({ url: "https://missav.ws/cn/caribbeancom", html: ++reads < 3 ? shell : listing(examples[2][1]) }),
  }, "https://missav.ws/cn/caribbeancom", 30_000, html => parser.parseMissAVVideoItems(html).length > 0)
  assert.equal(reads, 3)
  assert.equal(navigations, 1, "Wait for cards in the same WebView, not repeated requests")
  assert.equal(parser.parseMissAVVideoItems(delayed.html).length, 2)

  const originalRead = MockWebView.prototype.evaluateJavaScript
  MockWebView.prototype.evaluateJavaScript = async function() {
    delayedReads++
    return { url: this.url, html: shellOnly ? shell : this.html }
  }
  const client = new missavClient.constructor()
  shellOnly = true
  delayedReads = 0
  await assert.rejects(client.searchVideoPage({ collection: "caribbeancom" }), /栏目页面未读取到作品或分类/)
  assert.ok(delayedReads >= 10, "An incomplete listing is observed up to the bounded limit")
  assert.equal(client.searchPageCache.size, 0, "An incomplete first page must not become a cached empty result")
  shellOnly = false
  const recovered = await client.searchVideoPage({ collection: "caribbeancom" })
  assert.equal(recovered.items.length, 2, "Normal retry must recover without waiting for cache expiry")

  // Legitimate empty searches and filters keep their existing empty-state UI.
  shellOnly = true
  assert.deepEqual((await client.searchVideoPage({ collection: "caribbeancom", filter: "chinese-subtitle" })).items, [])
  MockWebView.prototype.evaluateJavaScript = originalRead
} finally {
  globalThis.setTimeout = nativeTimeout
}
const distractions = ["10musume", "1pondo", "today-hot", "genres/VR", "actresses/example-123", "search/n1854", "not-a-video", "n1854/extra"]
setMissAVBaseURL("https://missav.ws/")
assert.deepEqual(parser.parseMissAVVideoItems(distractions.map(code => card(code)).join("")), [], "Menu/category/search links must never become works")
assert.equal(parser.parseMissAVVideoItems('<a href="/cn/n1854">N1854 title only</a>').length, 0, "A code alone is not proof of a video card")
assert.equal(parser.parseMissAVVideoItems(card("gachip140", "/dm27/cn/")).length, 1)
console.log("MISSAV six uncensored columns, compact/underscore codes and 24 production loading cases passed")
