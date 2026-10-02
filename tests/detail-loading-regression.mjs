import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

globalThis.Storage = { get: () => undefined, set: () => {} }
globalThis.Keychain = { get: () => null, set: () => {} }
const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
const { loadWebViewPage } = await import(compile("../webview.ts"))
const diagnostics = await import(compile("../access-diagnostics.ts"))
const timers = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => timers(callback, delay === 300 ? 0 : delay, ...args)
const mediaURL = "https://cdn.example/1080p/video.m3u8?token=fixture"
const header = `<html><head><title>MISSAV</title></head><body><h1>Detail</h1>${"fixture ".repeat(80)}</body></html>`
const detail = header.replace("</body>", `<video src="${mediaURL}"></video></body>`)
const challenge = '<html><title>Just a moment</title><body><div id="challenge-form">Verify you are human</div></body></html>'
const controllers = []
let mode = "load", htmlForRead = () => detail
class MockWebView {
  reads = 0; waits = 0; disposed = false
  constructor() { controllers.push(this) }
  cookieReads = 0
  async getAllCookies() {
    this.cookieReads++
    if (mode === "cookie" && this.cookieReads > 1) return new Promise(resolve => { this.finishCapture = resolve })
    return []
  }
  loadURL(url) {
    this.url = url
    if (mode === "load") return new Promise(resolve => { this.finishLoad = resolve })
    return Promise.resolve(true)
  }
  waitForLoad() {
    this.waits++
    assert.equal(this.disposed, false)
    return new Promise(resolve => { this.finishWait = resolve })
  }
  async evaluateJavaScript() {
    assert.equal(this.disposed, false)
    assert.equal(this.loading, false, "Never evaluate JS concurrently with a pending native load")
    this.reads++
    return { url: this.url, html: htmlForRead(this.reads) }
  }
  dispose() { this.disposed = true }
}
const nativeLoad = MockWebView.prototype.loadURL
MockWebView.prototype.loadURL = async function(url) {
  this.loading = true
  try { return await nativeLoad.call(this, url) } finally { this.loading = false }
}
globalThis.WebViewController = MockWebView
const tick = () => new Promise(resolve => setImmediate(resolve))
async function promptly(request) {
  let timer
  try {
    return await Promise.race([request, new Promise((_, reject) => { timer = timers(() => reject(new Error("Detail waited for unrelated native loading")), 1_000) })])
  } finally { clearTimeout(timer) }
}

try {
  const pending = missavClient.getVideo("abc-123")
  await tick()
  const early = controllers.at(-1)
  assert.equal(early.reads, 0)
  early.finishLoad(true)
  const pendingLoad = await promptly(pending)
  assert.equal(pendingLoad.sources[0].url, mediaURL)
  await tick()
  assert.equal(early.disposed, true)
  assert.equal(early.waits, 0, "A late load callback cannot use a disposed controller")
  assert.equal(early.reads, 1)
  assert.equal(diagnostics.getMissAVAccessDiagnostics().findLast(item => item.phase === "detail-parse").parseCount, 1, "Final detail parsing reuses readiness parsing")

  mode = "cookie"
  assert.equal((await promptly(missavClient.getVideo("abc-130"))).sources[0].url, mediaURL, "Cookie backup cannot hold playable content")
  const captureView = controllers.at(-1)
  assert.equal(captureView.disposed, false, "Background cookie read retains its native controller")
  captureView.finishCapture([])
  await tick()
  assert.equal(captureView.disposed, true, "Cookie completion releases the retained controller")

  mode = "wait"
  assert.equal((await promptly(missavClient.getVideo("abc-124"))).sources[0].url, mediaURL)
  const pendingWait = controllers.at(-1)
  assert.equal(pendingWait.waits, 0, "loadURL completion must not register a second waitForLoad")
  await tick()
  assert.equal(pendingWait.reads, 1)

  mode = "wait"
  htmlForRead = reads => reads < 3 ? header : detail
  assert.equal((await promptly(missavClient.getVideo("abc-125"))).sources[0].url, mediaURL)
  assert.equal(controllers.at(-1).reads, 3, "A matching header alone is not playable detail content")
  await tick()

  htmlForRead = () => challenge
  await assert.rejects(promptly(missavClient.getVideo("abc-126")), /当前线路需要 Cloudflare 验证/)
  assert.equal(controllers.at(-1).disposed, true, "A prompt routes to Settings, never auto opens a modal")
  await tick()

  // No content still has a deadline, even if navigation never settles.
  htmlForRead = () => null
  mode = "load"
  const stalled = new MockWebView()
  await assert.rejects(loadWebViewPage(stalled, "https://missav.ws/cn/abc-127", 25, () => false), /网页加载超时/)
  stalled.dispose()
  const readsAtTimeout = stalled.reads
  stalled.finishLoad(true)
  await new Promise(resolve => timers(resolve, 5))
  assert.equal(stalled.waits, 0)
  assert.equal(stalled.reads, readsAtTimeout, "No more reads after timeout")

  const scope = new MissAVRequestScope()
  const cancelled = missavClient.getVideo("abc-128", { scope })
  const cancelledResult = assert.rejects(cancelled, isMissAVRequestCancelled)
  await tick()
  scope.cancel()
  await cancelledResult
  const cancelledView = controllers.at(-1)
  assert.equal(cancelledView.disposed, true)
  const readsAtCancel = cancelledView.reads
  cancelledView.finishLoad(true)
  await new Promise(resolve => timers(resolve, 5))
  assert.equal(cancelledView.reads, readsAtCancel)
  assert.equal(cancelledView.waits, 0)
  // The overall deadline also covers the verification gate, before native
  // loading has even begun. Accelerate only that deadline for this fixture.
  globalThis.setTimeout = (callback, delay, ...args) => timers(callback, delay === 20_000 ? 15 : delay, ...args)
  const finishVerification = missavClient.beginSiteVerification()
  const countBefore = controllers.length
  await assert.rejects(missavClient.getVideo("abc-129"), /获取播放信息超时/)
  finishVerification()
  await tick()
  assert.equal(controllers.length, countBefore, "An expired gate wait cannot start a late request")
  console.log("PASS: serial native loading; no duplicate load wait; strict source readiness; parse reuse; whole-request/gate deadline; cancellation and late-controller guards")
} finally {
  globalThis.setTimeout = timers
}
