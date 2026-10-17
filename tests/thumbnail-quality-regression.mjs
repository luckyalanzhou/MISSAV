import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

const { ThumbnailQualityQueue, highestSourceQuality, highestManifestQuality } = await import(compile("../thumbnail-quality-queue.ts"))
assert.equal(highestSourceQuality([{ qualityHeight: 720 }, {}, { qualityHeight: 2160 }, { qualityHeight: 1080 }]), 2160)
assert.equal(highestSourceQuality([{ qualityHeight: NaN }, { qualityHeight: Infinity }, { qualityHeight: -1 }, { qualityHeight: 1080.5 }]), null)
assert.equal(highestManifestQuality('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160\n2160.m3u8'), 2160)
assert.equal(highestManifestQuality('#EXTM3U\n#EXTINF:5.0\n2160p.ts'), null, "Segment names cannot establish resolution")
assert.equal(highestManifestQuality('<html>RESOLUTION=3840x2160</html>'), null)

const realTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout, realNow = Date.now
let now = Date.now(), timerID = 0
const timers = new Map()
globalThis.setTimeout = (callback, delay) => { const id = ++timerID; timers.set(id, { callback, at: now + delay }); return id }
globalThis.clearTimeout = id => timers.delete(id)
Date.now = () => now
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
async function tick() {
  const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
  if (next) { now = next[1].at; timers.delete(next[0]); next[1].callback() }
  await settle()
}
const video = code => ({ videoCode: code, detailPath: `/cn/${code}`, title: code, coverUrl: "cover" })
let context = "ws|1", ready = true, saved = []
const requests = [], seen = []
const options = {
  key: item => `${context.split("|")[0]}|${item.videoCode}`,
  context: () => context,
  canStart: () => ready,
  read: () => saved,
  write: values => { saved = JSON.parse(JSON.stringify(values)) },
  load: (item, scope) => new Promise((resolve, reject) => requests.push({ item, scope, resolve, reject })),
}
try {
  const queue = new ThumbnailQualityQueue(options)
  queue.watch(video("skipped"), () => {})()
  await tick()
  assert.equal(requests.length, 0, "Rows scrolled away before debounce make no request")
  const offA = queue.watch(video("A"), height => seen.push(["A", height]))
  const offA2 = queue.watch(video("A"), height => seen.push(["A2", height]))
  const offB = queue.watch(video("B"), () => {})
  await tick()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].item.videoCode, "A")
  offA(); offB()
  assert.equal(requests[0].scope.cancelled, false, "One remaining visible owner retains the request")
  requests[0].resolve(1080); await settle()
  assert.deepEqual(seen.at(-1), ["A2", 1080])
  offA2(); await tick()
  assert.equal(requests.length, 1, "No off-screen work runs after completion")
  const offCached = queue.watch(video("A"), height => seen.push(["cached", height]))
  assert.deepEqual(seen.at(-1), ["cached", 1080]); offCached()
  const restarted = new ThumbnailQualityQueue(options)
  restarted.watch(video("A"), height => seen.push(["restart", height]))()
  assert.deepEqual(seen.at(-1), ["restart", 1080], "Persistent cache stores only quality metadata")
  assert.doesNotMatch(JSON.stringify(saved), /cover|m3u8|token/)

  ready = false
  const offC = queue.watch(video("C"), () => {})
  await tick(); assert.equal(requests.length, 1, "Foreground work has priority")
  ready = true; await tick(); assert.equal(requests.length, 2)
  offC(); await settle()
  assert.equal(requests[1].scope.cancelled, true)
  requests[1].resolve(2160); await settle()
  assert.equal(saved.some(entry => entry.key.endsWith("|C")), false, "Late cancellation cannot populate cache")

  const offD = queue.watch(video("D"), () => {})
  const offE = queue.watch(video("E"), () => {})
  await tick(); requests.at(-1).reject(new Error("当前线路需要 Cloudflare 验证")); await settle(); await tick()
  assert.equal(requests.length, 3, "A challenge stops the rest of this verification context")
  offD(); offE()
  context = "ws|2"
  const offE2 = queue.watch(video("E"), () => {})
  await tick(); assert.equal(requests.length, 4, "Verification revision permits a new attempt")
  requests.at(-1).resolve(null); await settle(); offE2()
  queue.watch(video("E"), () => {})(); await tick()
  assert.equal(requests.length, 4, "Unknown quality is not repeatedly fetched or fabricated")

  context = "ai|2"
  const offOther = queue.watch(video("A"), () => {})
  await tick(); assert.equal(requests.length, 5, "Domain changes cannot reuse another host's quality")
  requests.at(-1).scope.cancel(); await settle(); await tick()
  assert.equal(requests.length, 5, "A timeout cancellation is not retried forever")
  offOther()
  now += 24 * 60 * 60_000 + 1
  context = "ws|2"
  const offExpired = queue.watch(video("A"), () => {})
  await tick(); assert.equal(requests.length, 6, "Expired quality is refreshed")
  offExpired(); await settle()
  queue.pause(); restarted.pause()
  assert.equal(timers.size, 0, "No orphan queue timer remains")
} finally {
  globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClear; Date.now = realNow
}

globalThis.Storage = { get: () => undefined, set() {} }
const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
const client = new missavClient.constructor()
const pending = []
client.loadVideo = (item, scope) => scope.waitFor(new Promise(resolve => pending.push({ scope, resolve })))
const scope = new MissAVRequestScope()
const background = client.getVideo(video("A"), { scope, background: true }).catch(error => error)
const foreground = client.getVideo(video("B"))
assert.equal(scope.cancelled, true, "Entering a detail cancels the background request immediately")
assert.equal(client.canLoadThumbnailQuality(), false)
assert.ok(isMissAVRequestCancelled(await background))
pending[1].resolve({ sources: [] }); await foreground
assert.equal(client.canLoadThumbnailQuality(), true)
const manifestScope = new MissAVRequestScope()
const release = client.trackThumbnailWork(manifestScope)
const finish = client.beginSiteVerification()
assert.equal(manifestScope.cancelled, true, "Verification also cancels playlist metadata work")
assert.equal(client.canLoadThumbnailQuality(), false)
const revision = client.thumbnailAccessRevision
finish(); release()
assert.equal(client.thumbnailAccessRevision, revision + 1)
assert.equal(client.canLoadThumbnailQuality(), true)
console.log("PASS: visible-only serial quality queue; deduplication, caching, expiry, cancellation, foreground priority, verification blocking and HLS metadata")
