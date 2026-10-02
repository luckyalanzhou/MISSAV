import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

const storage = new Map()
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
globalThis.Keychain = { get: () => null, set: () => {} }
const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
const { openMissAVSiteVerification } = await import(compile("../site-verification.ts"))
const { setMissAVBaseURL } = await import(compile("../domain.ts"))
const diagnostics = await import(compile("../access-diagnostics.ts"))
const freshClient = () => new missavClient.constructor()
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
const listing = code => `<html><head><title>MISSAV</title></head><body><h1>List</h1>
  <a href="/cn/${code}"><img src="/cover.jpg" alt="${code} title">1:02:03</a><a href="/cn/${code}">${code} title</a><footer>${"fixture ".repeat(80)}</footer></body></html>`
const challenge = '<html><title>Just a moment</title><body><div id="challenge-form">Verify you are human</div></body></html>'
const controllers = []
const requests = []
let holdLoads = false
let holdCookies = false
let response = () => listing("fixture-001")
let presentationError = null
class MockWebView {
  disposed = 0
  reads = 0
  writes = 0
  constructor() { controllers.push(this) }
  async getAllCookies() {
    if (holdCookies) await new Promise(resolve => { this.resumeCookies = resolve })
    return []
  }
  async setCookie() { this.writes++; assert.equal(this.disposed, 0); return true }
  async loadURL(url) {
    this.url = url
    requests.push(url)
    if (holdLoads) await new Promise(resolve => { this.resume = resolve })
    this.html = response(url)
    return true
  }
  async waitForLoad() { assert.equal(this.disposed, 0); return true }
  async evaluateJavaScript() { this.reads++; assert.equal(this.disposed, 0); return { url: this.url, html: this.html } }
  present() { if (presentationError) throw presentationError; return Promise.resolve() }
  dismiss() {}
  dispose() { this.disposed++ }
}
globalThis.WebViewController = MockWebView

// Two owners, one native load. Cancelling one owner does not dispose it.
holdLoads = true
let client = freshClient()
const a = new MissAVRequestScope(), b = new MissAVRequestScope()
const first = client.searchVideoPage({ collection: "release" }, { scope: a })
const firstCancelled = assert.rejects(first, isMissAVRequestCancelled)
const second = client.searchVideoPage({ collection: "release" }, { scope: b })
await settle()
assert.equal(requests.length, 1)
const shared = controllers.at(-1)
a.cancel()
await firstCancelled
assert.equal(shared.disposed, 0)
shared.resume()
assert.equal((await second).items[0].videoCode, "fixture-001")
assert.equal(shared.disposed, 1)

// Last owner cancels: dispose now, reject now, and never read a late load.
client = freshClient()
const owner = new MissAVRequestScope()
const cancelled = client.searchVideoPage({ collection: "new" }, { scope: owner })
const cancelledResult = assert.rejects(cancelled, isMissAVRequestCancelled)
await settle()
const late = controllers.at(-1)
owner.cancel()
await cancelledResult
assert.equal(late.disposed, 1)
late.resume()
await settle()
assert.equal(late.reads, 0)
assert.equal(late.disposed, 1)
assert.equal(client.searchPageCache.size, 0)

// The same protection applies while the native cookie read is pending.
holdLoads = false
holdCookies = true
const cookieOwner = new MissAVRequestScope()
const interrupted = client.searchVideoPage({ collection: "new" }, { scope: cookieOwner })
const interruptedResult = assert.rejects(interrupted, isMissAVRequestCancelled)
await settle()
const lateCookies = controllers.at(-1)
cookieOwner.cancel()
await interruptedResult
lateCookies.resumeCookies()
await settle()
assert.equal(lateCookies.writes, 0)
assert.equal(lateCookies.reads, 0)
assert.equal(lateCookies.disposed, 1)
holdCookies = false

// Verification is a gate; queued work consumes the verified page, no load.
client = freshClient()
const finish = client.beginSiteVerification()
const before = requests.length
const queued = client.searchVideoPage({ collection: "release", page: 2, sort: "views", filter: "multiple" })
const waitingOwner = new MissAVRequestScope()
const waiting = client.searchVideoPage({ collection: "new" }, { scope: waitingOwner })
const waitingCancelled = assert.rejects(waiting, isMissAVRequestCancelled)
waitingOwner.cancel()
await waitingCancelled
await settle()
assert.equal(requests.length, before)
const probe = { collection: "release", title: "Release", url: "https://missav.ws/cn/release?page=2&sort=views&filters=multiple", params: { collection: "release", page: 2, sort: "views", filter: "multiple" } }
for (const url of ["https://missav.ai/cn/release?page=2&sort=views&filters=multiple", "https://missav.ws/cn/new?page=2&sort=views&filters=multiple", "https://missav.ws/cn/release?page=1&sort=views&filters=multiple"]) {
  assert.equal(client.cacheVerifiedPage(probe, { url, html: listing("wrong-001") }), false)
}
assert.equal(client.cacheVerifiedPage(probe, { url: probe.url, html: challenge }), false)
const dynamic = "https://missav.ws/dm635/cn/release?page=2&sort=views&filters=multiple"
assert.equal(client.cacheVerifiedPage(probe, { url: dynamic, html: listing("verified-002") }), true)
finish()
finish()
const cached = await queued
assert.equal(cached.items[0].videoCode, "verified-002")
assert.equal(cached.page, 2)
assert.equal(requests.length, before, "Post-verification reads reuse the verified page")
cached.items[0].title = "Mutated by caller"
assert.notEqual((await client.searchVideoPage(probe.params)).items[0].title, "Mutated by caller")
await client.searchVideoPage(probe.params, { forceRefresh: true })
assert.equal(requests.length, before + 1, "Manual forced refresh remains an actual refresh")

// Actual Settings verification prioritizes the failed full URL, single-flights
// concurrent clicks and retains successfully checked pages for later callers.
missavClient.clearSearchPageCache()
missavClient.clearVerificationCollections()
response = () => challenge
await assert.rejects(missavClient.searchVideoPage({ collection: "release", page: 2, sort: "views", filter: "individual" }), /Cloudflare/)
response = () => listing("verified-003")
const verificationStart = requests.length
const verifyA = openMissAVSiteVerification(), verifyB = openMissAVSiteVerification()
assert.equal(verifyA, verifyB)
const browseAfter = missavClient.searchVideoPage({ collection: "release", page: 2, sort: "views", filter: "individual" })
assert.equal((await verifyA).status, "accessible")
const failedURL = new URL(requests[verificationStart])
assert.equal(failedURL.pathname, "/cn/release")
assert.equal(failedURL.searchParams.get("page"), "2")
assert.equal(failedURL.searchParams.get("sort"), "views")
assert.equal(failedURL.searchParams.get("filters"), "individual")
const verificationEnd = requests.length
assert.equal((await browseAfter).items[0].videoCode, "verified-003")
assert.equal(requests.length, verificationEnd)
await missavClient.searchVideoPage({ collection: "new", sort: "published_at", page: 1 })
assert.equal(requests.length, verificationEnd)

// Even a native presentation failure releases the gate and waiting requests.
missavClient.clearSearchPageCache()
response = () => challenge
presentationError = new Error("Fixture presentation failure")
const failedVerify = openMissAVSiteVerification()
const failedVerifyResult = assert.rejects(failedVerify, /Fixture presentation failure/)
const resumed = missavClient.searchVideoPage({ collection: "new" })
await failedVerifyResult
presentationError = null
response = () => listing("resumed-004")
assert.equal((await resumed).items[0].videoCode, "resumed-004")

// Domain changes cannot seed an old-domain result into the current domain.
setMissAVBaseURL("https://missav.ai/")
assert.equal(client.cacheVerifiedPage(probe, { url: probe.url, html: listing("old-domain-001") }), false)
setMissAVBaseURL("https://missav.ws/")
const homeSource = readFileSync(new URL("../page/index.tsx", import.meta.url), "utf8")
assert.match(homeSource, /onAccessVerified=\{bumpAccess\}/)
assert.doesNotMatch(homeSource, /key=\{`(?:home|discover)-\$\{accessRevision/)
const discoverSource = readFileSync(new URL("../page/discover.tsx", import.meta.url), "utf8")
assert.match(discoverSource, /props\.accessRevision && firstLoad\.current\) void load\(\)/)
console.log("PASS: shared-owner cancellation, disposed-controller guards, verification gate/cache reuse, exact failed-route priority, single-flight and refresh preservation")

// Readiness checks and final parsing must share one parse of an identical HTML snapshot.
diagnostics.clearMissAVAccessDiagnostics()
response = () => listing("memo-005")
await freshClient().searchVideoPage({ collection: "new" })
const parsed = diagnostics.getMissAVAccessDiagnostics().findLast(entry => entry.phase === "listing-parse")
assert.equal(parsed.state, "normal")
assert.equal(parsed.parseCount, 1)
const loaded = diagnostics.getMissAVAccessDiagnostics().findLast(entry => entry.event === "page")
for (const field of ["cookieMs", "loadMs", "captureMs"]) assert.ok(Number.isFinite(loaded[field]) && loaded[field] >= 0)
console.log("PASS: identical snapshot parsing is reused; cookie/load/capture phases are timed")
