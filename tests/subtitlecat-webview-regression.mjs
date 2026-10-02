// Validate the real subtitle readiness loop without an iPhone or wall-clock waits.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../subtitlecat-webview.ts", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const target = "https://www.subtitlecat.com/subs/1/FNS-258.html"
const readyHTML = "<h2>All language subtitles</h2>"

function harness() {
  const timers = new Map()
  let time = 0
  let timerID = 0
  let window = {}
  let location = { href: "about:blank" }
  let document = { documentElement: { outerHTML: "" } }
  let reads = 0
  let cancelled = false
  let loadResolve
  let loadReject
  let onLoad = () => {}
  let blockedRead
  const module = { exports: {} }
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(() => { throw new Error("No native imports expected") }, module, module.exports,
    (fn, delay) => { const id = ++timerID; timers.set(id, { fn, at: time + delay }); return id }, id => timers.delete(id))
  const controller = {
    evaluateJavaScript: async script => {
      if (script.startsWith("return")) {
        reads++
        if (blockedRead) return new Promise(resolve => { blockedRead.resolve = resolve })
      }
      return new Function("window", "location", "document", script)(window, location, document)
    },
    loadURL: () => { onLoad(); return new Promise((resolve, reject) => { loadResolve = resolve; loadReject = reject }) },
    waitForLoad: () => { throw new Error("Must not wait for every subresource") },
  }
  const navigate = (url = target, html = readyHTML) => { window = {}; location = { href: url }; document = { documentElement: { outerHTML: html } } }
  return { controller, navigate, timers,
    run(timeoutMs = 1000) { return module.exports.loadSubtitleWebViewDocument(controller, target, {
      timeoutMs,
      checkCancelled: () => { if (cancelled) throw new Error("cancelled") },
      accept: value => value.url === target && /All language subtitles/.test(value.html),
    }) },
    loadImmediately() { onLoad = () => navigate() },
    rejectLoad() { loadReject(new Error("Subresource failed late")) },
    blockRead() { blockedRead = {} },
    finishRead() { blockedRead.resolve(JSON.stringify({ url: target, html: readyHTML })); blockedRead = null },
    cancel() { cancelled = true },
    tick(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn() } },
    get reads() { return reads },
  }
}

const fast = harness()
fast.loadImmediately()
const document = await fast.run()
assert.equal(document.url, target)
assert.equal(document.html, readyHTML, "Use valid main content while loadURL is still pending")
assert.equal(fast.timers.size, 0)
fast.rejectLoad()
await settle()

const stale = harness()
stale.navigate()
let finished = false
const staleRun = stale.run().then(value => { finished = true; return value })
await settle()
assert.equal(finished, false, "A previous document at the same URL must not count as new content")
stale.navigate("https://evil.example/subs/1/FNS-258.html")
stale.tick(250)
await settle()
assert.equal(finished, false, "Ignore content from another URL even when it has a listing marker")
stale.navigate()
stale.tick(250)
await settle()
assert.equal((await staleRun).previousDocument, false)

const hanging = harness()
hanging.blockRead()
const hangingRun = hanging.run()
const timeout = assert.rejects(hangingRun, /网页读取超时/)
await settle()
hanging.tick(1000)
await timeout
const readsBeforeLateCompletion = hanging.reads
hanging.finishRead()
await settle()
assert.equal(hanging.reads, readsBeforeLateCompletion, "A timed-out native bridge callback cannot restart polling")
assert.equal(hanging.timers.size, 0)

const cancelled = harness()
const cancelledRun = cancelled.run()
const cancellation = assert.rejects(cancelledRun, /cancelled/)
await settle()
cancelled.cancel()
cancelled.tick(250)
await cancellation
assert.equal(cancelled.timers.size, 0)
console.log("PASS: main-document readiness without waitForLoad; stale/wrong URL rejection; bounded bridge timeout; late-callback and cancellation cleanup")
