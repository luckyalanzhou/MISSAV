// Run the production search engine with controlled network/native completion order.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../subtitlecat.ts", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const entryURL = index => `https://www.subtitlecat.com/subs/${index}/FNS-258-${index}.html`
const searchHTML = count => `<h2>${count} subtitles found</h2>${Array.from({ length: count }, (_, index) => `<a href="${entryURL(index)}">FNS-258 ${index}</a>`).join("")}`
const detailHTML = (index, language = "en") => `<h2>All language subtitles</h2><a id="download_${language}" href="/subs/${index}/FNS-258-${index}-${language}.srt">Download</a>`

function harness(count = 5, storage = new Map()) {
  const requests = []
  const fallbacks = []
  const progress = []
  let cancelled = false
  let active = 0
  let peak = 0
  let currentURL = ""
  let currentHTML = ""
  let clock = Date.now()
  let searchRequests = 0
  const module = { exports: {} }
  new Function("require", "module", "exports", "Storage", "Date", compiled)(specifier => {
    if (specifier === "scripting") return { fetch: async url => {
      if (url.includes("index.php")) { searchRequests++; return { ok: true, text: async () => searchHTML(count) } }
      active++; peak = Math.max(peak, active)
      return new Promise(resolve => requests.push({ url, finish(html, ok = true) { active--; resolve({ ok, status: ok ? 200 : 503, text: async () => html }) } }))
    } }
    if (specifier === "./webview") return { loadWebViewPage: async (_, url) => new Promise(resolve => fallbacks.push({ url, finish(html) { currentURL = url; currentHTML = html; resolve({ loaded: true, finished: true, html }) } })) }
    throw new Error(`Unexpected dependency: ${specifier}`)
  }, module, module.exports, { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }, { now: () => clock })
  const controller = { getHTML: async () => currentHTML, evaluateJavaScript: async () => currentURL }
  return { api: module.exports, controller, requests, fallbacks, progress, storage,
    run(overrides = {}) { return module.exports.searchSubtitleCatFiles(controller, "FNS-258", { onProgress: result => progress.push(result), isCancelled: () => cancelled, ...overrides }) },
    cancel() { cancelled = true },
    advance(ms) { clock += ms },
    get searchRequests() { return searchRequests },
    get peak() { return peak },
  }
}

const parallel = harness()
const running = parallel.run()
await settle()
assert.equal(parallel.requests.length, 3)
assert.equal(parallel.peak, 3)
parallel.requests[1].finish(detailHTML(1, "en"))
await settle()
assert.equal(parallel.requests.length, 4, "Fill the freed worker slot immediately")
assert.equal(parallel.progress.at(-1).files.length, 1, "Publish files before all details complete")
assert.equal(parallel.progress.at(-1).processedDetailCount, 1)
parallel.requests[0].finish(detailHTML(0, "zh-CN"))
await settle()
assert.equal(parallel.requests.length, 5)
assert.equal(parallel.progress.at(-1).files[0].language, "简体中文")
for (let index = 2; index < 5; index++) parallel.requests[index].finish(detailHTML(index, index === 2 ? "zh-TW" : "en"))
const result = await running
assert.equal(result.processedDetailCount, 5)
assert.equal(result.failedDetailCount, 0)
assert.equal(result.metrics.httpRequests, 6)
assert.equal(result.metrics.webViewLoads, 0)
assert.equal(result.files.length, 5)
assert.deepEqual(result.files.slice(0, 2).map(file => file.language), ["简体中文", "繁体中文"])
assert.ok(result.metrics.firstResultMs !== null)
assert.equal(parallel.peak, 3, "Never exceed the three-request limit")

const cachedResult = await parallel.run()
assert.equal(cachedResult.metrics.httpRequests, 0, "A complete fresh cache must not issue any requests")
assert.equal(cachedResult.metrics.searchCacheHits, 1)
assert.equal(cachedResult.metrics.detailCacheHits, 5)
assert.equal(cachedResult.files.length, 5)
const restarted = harness(5, parallel.storage)
assert.equal((await restarted.run()).metrics.httpRequests, 0, "Persistent cache must survive a new module/script instance")
assert.equal(restarted.searchRequests, 0)

const refresh = parallel.run({ forceRefresh: true })
await settle()
assert.equal(parallel.searchRequests, 2, "Explicit refresh must bypass the cached search")
assert.equal(parallel.requests.length, 8)
for (let index = 5; index < 10; index++) {
  await settle()
  parallel.requests[index].finish(detailHTML(index - 5))
}
const refreshed = await refresh
assert.equal(refreshed.metrics.httpRequests, 6)
assert.equal(refreshed.metrics.detailCacheHits, 0)

restarted.advance(30 * 60 * 1000 + 1)
const expired = restarted.run()
await settle()
assert.equal(restarted.searchRequests, 1, "Expired cache must search the website again")
for (let index = 0; index < 5; index++) {
  await settle()
  restarted.requests[index].finish(detailHTML(index))
}
assert.equal((await expired).metrics.httpRequests, 6)

const serialFallback = harness(3)
const fallbackRun = serialFallback.run()
await settle()
serialFallback.requests.forEach(request => request.finish("<html>Unavailable</html>", false))
await settle()
assert.equal(serialFallback.fallbacks.length, 1, "Only one controller navigation may run at a time")
serialFallback.fallbacks[0].finish(detailHTML(0, "zh-CN"))
await settle()
assert.equal(serialFallback.fallbacks.length, 2)
serialFallback.fallbacks[1].finish(detailHTML(1, "zh-TW"))
await settle()
assert.equal(serialFallback.fallbacks.length, 3)
serialFallback.fallbacks[2].finish(detailHTML(2))
assert.equal((await fallbackRun).files.length, 3)

const stopped = harness(10)
const stoppedRun = stopped.run()
const cancelledAssertion = assert.rejects(stoppedRun, /搜索已停止/)
await settle()
const updatesBeforeStop = stopped.progress.length
stopped.cancel()
stopped.requests.forEach((request, index) => request.finish(detailHTML(index)))
await cancelledAssertion
assert.equal(stopped.requests.length, 3, "Cancellation must not schedule remaining entries")
assert.equal(stopped.progress.length, updatesBeforeStop, "Cancellation suppresses late publications")
assert.equal(stopped.fallbacks.length, 0)

const noResults = harness(0)
const zero = await noResults.run()
assert.equal(zero.searchResultCount, 0)
assert.equal(zero.files.length, 0)
assert.equal(noResults.requests.length, 0)

const partial = harness(2)
const partialRun = partial.run()
await settle()
partial.requests[0].finish(detailHTML(0, "zh-CN"))
partial.requests[1].finish("Unavailable", false)
await settle()
partial.fallbacks[0].finish("<html>Not a subtitle page</html>")
assert.equal((await partialRun).failedDetailCount, 1)
const partialRetry = partial.run()
await settle()
assert.equal(partial.requests.length, 3, "Retry only the failed detail, not the successful one")
assert.equal(partial.searchRequests, 1, "Reuse the successful search result")
assert.equal(partial.progress.at(-1).files[0].language, "简体中文", "Show cached partial files before retry completes")
partial.requests[2].finish(detailHTML(1, "zh-TW"))
const retried = await partialRetry
assert.equal(retried.metrics.httpRequests, 1)
assert.equal(retried.metrics.detailCacheHits, 1)
assert.equal(retried.failedDetailCount, 0)

const corruptStorage = new Map([["missav_subtitlecat_search_cache_v1", "{ broken JSON"]])
assert.equal((await harness(0, corruptStorage).run()).metrics.httpRequests, 1, "Corrupt cache must fail open to normal search")
const limited = harness(0)
for (let index = 0; index < 51; index++) {
  limited.advance(1)
  await limited.api.searchSubtitleCatFiles(limited.controller, `TEST-${index}`)
}
const records = JSON.parse(limited.storage.get("missav_subtitlecat_search_cache_v1")).records
assert.equal(Object.keys(records).length, 50, "Keep at most 50 video codes")
assert.equal(records["TEST-0"], undefined, "Evict the oldest cache record")
assert.ok(records["TEST-50"])
const unsafe = new Map([["missav_subtitlecat_search_cache_v1", JSON.stringify({ version: 1, records: {
  "FNS-258": { savedAt: Date.now(), touchedAt: Date.now(), entries: [{ title: "FNS-258", url: "https://evil.example/subs/1/FNS-258.html" }], details: {} },
} })]])
assert.equal((await harness(0, unsafe).run()).metrics.httpRequests, 1, "Persisted foreign URLs cannot be accepted as cache hits")
const unavailableStorage = new Map()
unavailableStorage.set = () => { throw new Error("Storage unavailable") }
assert.equal((await harness(0, unavailableStorage).run()).searchResultCount, 0, "Storage failure must not break valid online search")
console.log("PASS: persistent two-layer cache; zero-request repeat; explicit refresh; 30-minute expiry; failed-detail-only retry; corrupt cache safety")
console.log("PASS: three HTTP workers; progressive Chinese-first results; serialized native fallback; cancellation; empty results; metrics")
