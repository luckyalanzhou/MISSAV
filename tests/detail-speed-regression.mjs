import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

const keychain = new Map()
globalThis.Storage = { get: () => undefined, set() {} }
globalThis.Keychain = { get: key => keychain.get(key), set: (key, value) => keychain.set(key, value), remove: key => keychain.delete(key) }
const clock = Date.now, info = console.info, warn = console.warn
let now = clock(), nativeReads = 0, challenge = false
Date.now = () => now
console.info = console.warn = () => {}
const controllers = []
const cookie = () => ({ name: "cf_clearance", value: "PRIVATE_COOKIE", domain: ".missav.ws", path: "/cn", expiresDate: new Date(now + 60_000) })
globalThis.WebViewController = class {
  disposed = false
  constructor() { controllers.push(this) }
  async getCookies() { nativeReads++; return [cookie()] }
  getAllCookies() { return new Promise(resolve => { this.finishBackup = resolve }) }
  async loadURL(url) { this.url = url; return true }
  async evaluateJavaScript() {
    return { url: this.url, html: challenge ? '<html><title>Just a moment</title><div id="challenge-form">Verify you are human</div></html>' : `<html><title>MISSAV</title><body>${"content ".repeat(80)}<video src="https://cdn.example/1080p/video.m3u8"></video></body></html>` }
  }
  dispose() { this.disposed = true }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
async function promptly(request) {
  let timer
  try { return await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Playable detail waited for cookie backup")), 500) })]) }
  finally { clearTimeout(timer) }
}
try {
  const { missavClient } = await import(compile("../client.ts"))
  const session = await import(compile("../cloudflare-session.ts"))
  const diagnostics = await import(compile("../access-diagnostics.ts"))
  const first = await promptly(missavClient.getVideo("abc-001"))
  assert.equal(first.sources.length, 1)
  assert.equal(nativeReads, 1)
  const owner = controllers.at(-1)
  assert.equal(owner.disposed, false, "Keep the controller alive until its deferred capture completes")
  now += 100
  await promptly(missavClient.getVideo("abc-002"))
  const second = controllers.at(-1)
  assert.equal(nativeReads, 1, "A recent confirmed shared session avoids another native Cookie read")
  owner.finishBackup([cookie()]); second.finishBackup([cookie()])
  await tick()
  assert.equal(owner.disposed && second.disposed, true)
  const page = diagnostics.getMissAVAccessDiagnostics().findLast(entry => entry.event === "page")
  assert.equal(page.captureDeferred, true)
  assert.equal(page.cookieState, "recent")
  assert.equal(page.elapsedMs, 0, "Page timing excludes deferred work after the playable result")
  assert.doesNotMatch(JSON.stringify(diagnostics.getMissAVAccessDiagnostics()), /PRIVATE_COOKIE/)

  challenge = true
  await assert.rejects(missavClient.getVideo("abc-003"), /Cloudflare/)
  assert.equal(nativeReads, 1)
  challenge = false
  await promptly(missavClient.getVideo("abc-004"))
  assert.equal(nativeReads, 2, "A real challenge invalidates recent evidence immediately")
  controllers.at(-1).finishBackup([cookie()]); await tick()
  now += 15_001
  await promptly(missavClient.getVideo("abc-005"))
  assert.equal(nativeReads, 3, "Evidence expires; the next request checks the live jar again")
  controllers.at(-1).finishBackup([cookie()]); await tick()

  // Background capture cannot write a snapshot after interactive verification
  // cancels its scope and releases the native controller.
  await promptly(missavClient.getVideo("abc-006"))
  const cancelledOwner = controllers.at(-1), snapshot = keychain.get("missav_cloudflare_cookie_v1_missav_ws")
  const finishVerification = missavClient.beginSiteVerification()
  assert.equal(cancelledOwner.disposed, true)
  cancelledOwner.finishBackup([{ ...cookie(), value: "LATE_COOKIE" }])
  await tick(); finishVerification()
  assert.equal(keychain.get("missav_cloudflare_cookie_v1_missav_ws"), snapshot)
  await promptly(missavClient.getVideo("abc-007"))
  assert.equal(nativeReads, 4, "Explicit verification resets the recent-session shortcut")
  controllers.at(-1).finishBackup([cookie()]); await tick()

  // Path, host, expiry and explicit opt-in preserve the full restoration path.
  session.invalidateRecentCloudflareSession("missav.ws")
  keychain.clear()
  let pathReads = 0
  const jar = { getCookies: async () => { pathReads++; return [{ ...cookie(), path: "/cn/login", expiresDate: new Date(now + 500) }] } }
  await session.restoreCloudflareSessionDetailed(jar, "https://missav.ws/cn/login")
  assert.equal((await session.restoreCloudflareSessionDetailed(jar, "https://missav.ws/cn/login", undefined, { allowRecent: true })).state, "recent")
  assert.equal(pathReads, 1)
  await session.restoreCloudflareSessionDetailed(jar, "https://missav.ws/cn/detail", undefined, { allowRecent: true })
  assert.equal(pathReads, 2, "A narrow cookie path cannot authorize another route")
  await session.restoreCloudflareSessionDetailed(jar, "https://missav.ai/cn/login", undefined, { allowRecent: true })
  assert.equal(pathReads, 3, "Cookie evidence cannot cross domains")
  await session.restoreCloudflareSessionDetailed(jar, "https://missav.ws/cn/login")
  assert.equal(pathReads, 4, "Default/isolated callers never reuse recent evidence")
  now += 501
  assert.notEqual((await session.restoreCloudflareSessionDetailed(jar, "https://missav.ws/cn/login", undefined, { allowRecent: true })).state, "recent")
  assert.equal(pathReads, 5)
  const nativeTimer = globalThis.setTimeout
  globalThis.setTimeout = (callback, delay, ...args) => nativeTimer(callback, delay === 2_000 ? 15 : delay, ...args)
  try {
    await promptly(missavClient.getVideo("abc-008"))
    const timedOutOwner = controllers.at(-1)
    await new Promise(resolve => nativeTimer(resolve, 25))
    assert.equal(timedOutOwner.disposed, true, "A never-settling deferred capture still releases its controller")
    timedOutOwner.finishBackup([cookie()])
    await tick()
    assert.equal(keychain.size, 0, "A late native capture result after its deadline is never persisted")
  } finally { globalThis.setTimeout = nativeTimer }
  console.log("PASS: no cookie backup on detail critical path; recent shared-session reuse; TTL/expiry/path/domain guards; challenge invalidation; bounded ownership and late-write cancellation")
} finally { Date.now = clock; console.info = info; console.warn = warn }
