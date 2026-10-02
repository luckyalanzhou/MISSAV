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
  async getAllCookies() { return [] }
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
    this.reads++
    return { url: this.url, html: htmlForRead(this.reads) }
  }
  dispose() { this.disposed = true }
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
  const pendingLoad = await promptly(missavClient.getVideo("abc-123"))
  assert.equal(pendingLoad.sources[0].url, mediaURL)
  const early = controllers.at(-1)
  assert.equal(early.disposed, true)
  early.finishLoad(true)
  await tick()
  assert.equal(early.waits, 0, "A late load callback cannot use a disposed controller")
  assert.equal(early.reads, 1)
  assert.equal(diagnostics.getMissAVAccessDiagnostics().findLast(item => item.phase === "detail-parse").parseCount, 1, "Final detail parsing reuses readiness parsing")

  mode = "wait"
  assert.equal((await promptly(missavClient.getVideo("abc-124"))).sources[0].url, mediaURL)
  const pendingWait = controllers.at(-1)
  assert.equal(pendingWait.waits, 1)
  pendingWait.finishWait(true)
  await tick()
  assert.equal(pendingWait.reads, 1)

  mode = "load"
  htmlForRead = reads => reads < 3 ? header : detail
  assert.equal((await promptly(missavClient.getVideo("abc-125"))).sources[0].url, mediaURL)
  assert.equal(controllers.at(-1).reads, 3, "A matching header alone is not playable detail content")
  controllers.at(-1).finishLoad(true)
  await tick()

  htmlForRead = () => challenge
  await assert.rejects(promptly(missavClient.getVideo("abc-126")), /当前线路需要 Cloudflare 验证/)
  assert.equal(controllers.at(-1).disposed, true, "A prompt routes to Settings, never auto opens a modal")
  controllers.at(-1).finishLoad(true)
  await tick()

  // No content still has a deadline, even if navigation never settles.
  htmlForRead = () => null
  const stalled = new MockWebView()
  await assert.rejects(loadWebViewPage(stalled, "https://missav.ws/cn/abc-127", 25, () => false, undefined, { readWhileLoading: true }), /网页加载超时/)
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
  console.log("PASS: detail returns before native load/wait; strict source readiness; parse reuse; challenge/deadline/cancellation and late-controller guards")
} finally {
  globalThis.setTimeout = timers
}
