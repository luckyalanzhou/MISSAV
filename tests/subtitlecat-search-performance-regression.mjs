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

function harness(count = 5) {
  const requests = []
  const fallbacks = []
  const progress = []
  let cancelled = false
  let active = 0
  let peak = 0
  let currentURL = ""
  let currentHTML = ""
  const module = { exports: {} }
  new Function("require", "module", "exports", compiled)(specifier => {
    if (specifier === "scripting") return { fetch: async url => {
      if (url.includes("index.php")) return { ok: true, text: async () => searchHTML(count) }
      active++; peak = Math.max(peak, active)
      return new Promise(resolve => requests.push({ url, finish(html, ok = true) { active--; resolve({ ok, status: ok ? 200 : 503, text: async () => html }) } }))
    } }
    if (specifier === "./webview") return { loadWebViewPage: async (_, url) => new Promise(resolve => fallbacks.push({ url, finish(html) { currentURL = url; currentHTML = html; resolve({ loaded: true, finished: true, html }) } })) }
    throw new Error(`Unexpected dependency: ${specifier}`)
  }, module, module.exports)
  const controller = { getHTML: async () => currentHTML, evaluateJavaScript: async () => currentURL }
  return { api: module.exports, controller, requests, fallbacks, progress,
    run() { return module.exports.searchSubtitleCatFiles(controller, "FNS-258", { onProgress: result => progress.push(result), isCancelled: () => cancelled }) },
    cancel() { cancelled = true },
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
console.log("PASS: three HTTP workers; progressive Chinese-first results; serialized native fallback; cancellation; empty results; metrics")
