import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"
globalThis.Storage = { get: () => null, set: () => {} }
globalThis.Keychain = { get: () => null, set: () => {} }
const parser = await import(compile("../html-parser.ts"))
const dom = await import(compile("../listing-dom.ts"))
const { readMatchingWebViewDocument, loadWebViewPage } = await import(compile("../webview.ts"))
const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
const diagnostics = await import(compile("../access-diagnostics.ts"))
const require = createRequire(import.meta.url)
const { chromium } = require(process.argv[2] ? process.argv[2].replace(/lib[\\/]transform[\\/]babelBundle\.js$/, "index.js") : "playwright")
const executablePath = [process.env.MISSAV_TEST_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(path => path && existsSync(path))
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const page = await browser.newPage()
let body
await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body }) : route.abort())
const codes = ["test-001", "n1854", "092426_001", "092727-001", "092626_01", "092626_100", "gachip140"]
try {
  assert.equal(dom.isMissAVDOMExtractionTrialEnabled(), false, "The unverified phone path remains opt-in")
  dom.setMissAVDOMExtractionTrialEnabled(true)
  for (const code of codes) {
    const url = "https://missav.ws/cn/new?sort=published_at"
    body = `<html><head><title>MISSAV</title><script>const bigUnusedData='${"unused ".repeat(200)}'</script></head><body><main><h1>List</h1><a href="/cn/${code}"><img src="/cover.jpg" alt="${code} title">2:10:00</a><a href="/cn/${code}">${code} title</a><a href="/cn/new?page=2&sort=published_at">Next</a><a href="/cn/broken%ZZ">bad</a></main><footer><a href="/cn/contact">Contact</a></footer></body></html>`
    await page.goto(url)
    const controller = { evaluateJavaScript: script => page.evaluate(source => new Function(source)(), script) }
    const document = await readMatchingWebViewDocument(controller, url)
    assert.ok(document.compactHTML.length < document.html.length)
    assert.doesNotMatch(document.compactHTML, /bigUnusedData|<footer/)
    const full = parser.parseMissAVSearchPage(document.html, 1)
    assert.equal(full.items[0].videoCode, code)
    const chosen = dom.selectMissAVDOMPage(url, full, document.compactHTML, source => parser.parseMissAVSearchPage(source, 1))
    assert.deepEqual(chosen, full)
    assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).domMatched, true)
    assert.equal(dom.selectMissAVDOMPage(url, full, '<h1>Other</h1>', source => parser.parseMissAVSearchPage(source, 1)), full)
    assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).domMatched, false)
    assert.equal(await readMatchingWebViewDocument(controller, "https://missav.ws/cn/release"), null)
  }
  const directoryURL = "https://missav.ws/cn/genres"
  body = `<html><body>MISSAV<main><h1>Genres</h1><a href="/cn/genres/one"><img src="/one.jpg" alt="分类一">分类一</a><a href="/cn/genres/two">分类二</a><a href="/cn/genres?page=2">Next</a></main><footer>${"extra ".repeat(100)}</footer></body></html>`
  await page.goto(directoryURL)
  const controller = { evaluateJavaScript: script => page.evaluate(source => new Function(source)(), script) }
  const directory = await readMatchingWebViewDocument(controller, directoryURL)
  const fullDirectory = parser.parseMissAVDirectoryPage(directory.html, 1, "genres", directoryURL)
  assert.deepEqual(dom.selectMissAVDOMPage(directoryURL, fullDirectory, directory.compactHTML, html => parser.parseMissAVDirectoryPage(html, 1, "genres", directoryURL)), fullDirectory)
  assert.equal(fullDirectory.categories.length, 2)
  // Full-document challenge classification always wins over an injected valid compact listing.
  const challenge = '<html><title>Just a moment</title><body><div id="challenge-form">Verify you are human</div></body></html>'
  let disposed = 0
  globalThis.WebViewController = class {
    getAllCookies = async () => []
    loadURL = async url => { this.url = url; return true }
    waitForLoad = async () => true
    evaluateJavaScript = async () => ({ url: this.url, html: challenge, compactHTML: directory.compactHTML })
    dispose() { disposed++ }
  }
  await assert.rejects(new missavClient.constructor().searchVideoPage({ collection: "new" }), /Cloudflare/)
  assert.equal(disposed, 1)
  assert.equal(parser.extractMissAVVideoCode("/cn/bad%ZZ"), null)
  let release
  const scope = new MissAVRequestScope()
  const loading = loadWebViewPage({ loadURL: async () => true, waitForLoad: async () => true, evaluateJavaScript: () => new Promise(resolve => { release = resolve }) }, directoryURL, undefined, undefined, scope)
  const cancelled = assert.rejects(loading, isMissAVRequestCancelled)
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
  scope.cancel(); await cancelled; release(directory)
  console.log("PASS: real headless browser DOM extraction; seven code formats, directories and pagination parity; exact URL guards; mismatch/empty fallback; full-document Cloudflare authority; malformed-link isolation; cancellation")
} finally { dom.setMissAVDOMExtractionTrialEnabled(false); await browser.close() }
