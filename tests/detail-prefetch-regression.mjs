import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { compileProductionModule as compile } from "./production-module.mjs"
const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
let selectedDomain = "https://missav.ws/"
globalThis.Storage = { get: () => selectedDomain }
const scopes = await import(compile("../request-scope.ts"))
const domain = await import(compile("../domain.ts"))
const load = (relative, dependencies) => {
  const path = new URL(relative, import.meta.url).pathname.replace(/^\/(\w:)/, "$1")
  const module = { exports: {} }
  new Function("require", "module", "exports", babelTransform(readFileSync(new URL(relative, import.meta.url), "utf8"), path, false, [], [], "scripting").code)(name => dependencies[name] || {}, module, module.exports)
  return module.exports
}
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const video = { videoCode: "ABC-1", detailPath: "/cn/abc-1", coverUrl: "" }
let watches = 0
const artwork = load("../page/components/media_cards.tsx", {
  scripting: { ZStack: "ZStack", Image: "Image", useRef: value => ({ current: value }), useEffect() {} },
  "scripting/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  "../../detail-prefetch": { detailPrefetch: { watch() { watches++; return () => {} } } },
})
artwork.MediaArtwork({ video, height: 96 }).props.onAppear()
assert.equal(watches, 1, "Ordinary visible list artwork must start detail prefetch by default")
artwork.MediaArtwork({ video, height: 96, prefetch: false }).props.onAppear()
assert.equal(watches, 1, "Detail artwork explicitly opts out of speculative reads")
const { DetailPrefetchQueue } = load("../detail-prefetch.ts", { "./request-scope": scopes, "./domain": domain, "./client": { missavClient: { detailContext: () => "site", subscribeDetailContext() {} } }, "./lifecycle": { subscribeMissAVLifecycle() {} } })
let context = "site-1", wake, calls = [], cached = false
const queue = new DetailPrefetchQueue({
  context: () => context, canStart: () => true, cached: () => cached,
  changed: listener => { wake = listener; return () => {} }, delayMs: 0,
  load: (item, options) => options.scope.waitFor(new Promise((resolve, reject) => calls.push({ item, scope: options.scope, resolve: value => { cached = true; resolve(value) }, reject }))),
})
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 5)); await settle() }
const off1 = queue.watch(video)
await tick()
assert.equal(calls.length, 1)
const aliasVideo = { ...video, detailPath: "https://missav.ai/cn/abc-1" }
const off2 = queue.watch(aliasVideo)
assert.equal(calls.length, 1, "Domain aliases resolve to one shared video identity")
off1()
assert.equal(calls[0].scope.cancelled, false, "A second visible observer retains an active shared request")
const foreground = new scopes.MissAVRequestScope()
const selected = queue.load(aliasVideo, { scope: foreground })
off2()
assert.equal(calls[0].scope.cancelled, false, "Foreground selection takes over existing work")
calls[0].resolve({ sources: [{ label: "1080p" }] })
assert.equal((await selected).sources[0].label, "1080p")
assert.equal(calls.length, 1, "Clicking an in-flight card does not start another request")
cached = false
const off3 = queue.watch(video)
await tick()
queue.pause(); await settle()
assert.equal(calls.at(-1).scope.cancelled, true)
queue.resume(); await tick()
assert.equal(calls.length, 3, "Resume retains visible interest and restarts cancelled background work")
context = "site-2"; selectedDomain = "https://missav.ai/"; wake(); await tick()
assert.equal(calls[2].scope.cancelled, true, "Context change cancels old work")
assert.equal(calls.length, 4, "Visible interests are rescheduled for the new context")
const switchedScope = new scopes.MissAVRequestScope()
const switchedSelection = queue.load(aliasVideo, { scope: switchedScope })
assert.equal(calls.length, 4, "Changing the selected domain retains one canonical video identity")
assert.equal(calls[3].scope.cancelled, false, "Foreground selection after a domain change shares the restarted request")
calls[3].resolve({ sources: [{ label: "1080p" }] })
await switchedSelection
off3(); await settle()
assert.equal(calls[3].scope.cancelled, false)
queue.pause()
let takeoverCalls = []
const takeover = new DetailPrefetchQueue({
  context: () => "foreground", canStart: () => true, cached: () => false, changed: () => () => {},
  load: (item, options) => new Promise(resolve => takeoverCalls.push({ item, scope: options.scope, resolve })),
})
const firstScope = new scopes.MissAVRequestScope()
const firstForeground = takeover.load(video, { scope: firstScope })
firstForeground.catch(() => {})
await tick()
const nextVideo = { ...video, videoCode: "ABC-2", detailPath: "/cn/abc-2" }
const secondForeground = takeover.load(nextVideo, { scope: new scopes.MissAVRequestScope() })
await tick()
assert.equal(takeoverCalls.length, 2)
assert.equal(takeoverCalls[0].scope.cancelled, true, "A different foreground selection cancels the previous owned task")
takeoverCalls[1].resolve({ sources: [{ label: "720p" }] })
assert.equal((await secondForeground).sources[0].label, "720p")
await firstForeground.catch(() => {})
takeover.pause()
let failureReads = 0, recovered = false
const failing = new DetailPrefetchQueue({
  context: () => "offline", canStart: () => true, cached: () => false, changed: () => () => {}, delayMs: 0,
  load: async () => { failureReads++; if (!recovered) throw new Error("offline"); return { sources: [] } },
})
const stopFailed = failing.watch(video)
const stopOther = failing.watch({ ...video, detailPath: "/cn/abc-2", videoCode: "ABC-2" })
await tick(); await tick()
assert.equal(failureReads, 1, "A failed context stops background request storms")
recovered = true
failing.resume(); await tick(); await tick()
assert.equal(failureReads, 3, "Resume retries failed interests after recovery and continues queued visible work")
stopFailed(); stopOther(); failing.pause()
let available = false, visibleOrder = []
const visibleRecovery = new DetailPrefetchQueue({
  context: () => "visible-recovery", canStart: () => true, cached: () => false, changed: () => () => {}, delayMs: 0,
  load: async item => { visibleOrder.push(item.videoCode); if (!available) throw new Error("offline"); return { sources: [] } },
})
const stopVisibleOne = visibleRecovery.watch(video)
const stopVisibleTwo = visibleRecovery.watch({ ...video, videoCode: "ABC-2", detailPath: "/cn/abc-2" })
await tick(); await tick()
assert.deepEqual(visibleOrder, ["ABC-1"], "One failed prefetch blocks further requests in the same context")
available = true
const stopVisibleThree = visibleRecovery.watch({ ...video, videoCode: "ABC-3", detailPath: "/cn/abc-3" })
await tick(); await tick(); await tick(); await tick()
assert.equal(visibleOrder[1], "ABC-3", "A newly visible card gets the first retry after recovery")
stopVisibleOne(); stopVisibleTwo(); stopVisibleThree(); visibleRecovery.pause()
let cacheReads = 0
const reuse = new DetailPrefetchQueue({
  context: () => "cached", canStart: () => true, cached: () => true, changed: () => () => {}, delayMs: 0,
  load: async () => { cacheReads++; return { sources: [{ label: "1080p" }] } },
})
const stopCached = reuse.watch(video)
await tick()
assert.equal(cacheReads, 0, "Fresh cached details do not trigger background requests")
const cachedResult = await reuse.load(video, { scope: new scopes.MissAVRequestScope() })
assert.equal(cachedResult.sources[0].label, "1080p")
assert.equal(cacheReads, 1, "Foreground asks the cache-owning client to apply freshness and verification rules")
stopCached(); reuse.pause()
console.log("PASS: default artwork activation, alias identity sharing, foreground takeover, pause/resume, recovery and context invalidation")
