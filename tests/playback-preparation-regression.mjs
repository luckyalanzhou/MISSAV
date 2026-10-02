import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compileProductionModule } from "./production-module.mjs"
const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const deadline = await import(compileProductionModule("../request-deadline.ts"))
let finishProgress, finishSubtitles, enabled = true
const assets = []
globalThis.AVAsset = class {
  constructor(url, options) { this.source = url; this.options = options; this.disposals = 0; assets.push(this) }
  loadIsPlayable() { this.playableLoads = (this.playableLoads || 0) + 1; return Promise.resolve(true) }
  loadDuration() { this.durationLoads = (this.durationLoads || 0) + 1; return Promise.resolve({ seconds: 100 }) }
  dispose() { this.disposals++ }
}
const path = fileURLToPath(new URL("../playback-preparation.ts", import.meta.url)), module = { exports: {} }
new Function("require", "module", "exports", babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)(specifier => {
  if (specifier === "./request-deadline") return deadline
  if (specifier === "./client") return { missavClient: { playbackHeaders: () => ({ Referer: "watch" }) } }
  if (specifier === "./storage") return { loadMissAVPlaybackProgress: () => new Promise(resolve => { finishProgress = resolve }) }
  if (specifier === "./subtitles") return { isMissAVSubtitleEnabled: () => enabled, loadMissAVSubtitle: () => new Promise(resolve => { finishSubtitles = resolve }) }
  throw Error(specifier)
}, module, module.exports)
const { MissAVPlaybackPreparation } = module.exports
const prep = new MissAVPlaybackPreparation({ videoCode: "ABC-001" })
for (let i = 0; i < 10; i++) await Promise.resolve()
assert.ok(finishProgress && finishSubtitles, "Local data starts in parallel before detail is ready")
const source = { url: "https://media.test/1080p.mp4", label: "1080p" }
const detail = { watchUrl: "https://missav.ws/cn/abc-001", sources: [source] }
prep.prepareSource(detail); prep.prepareSource(detail)
assert.equal(assets.length, 1, "A single default source is prepared only once")
finishProgress({ positionSeconds: 35 }); finishSubtitles({ cues: [{ text: "caption" }] }); await prep.ready
assert.equal(prep.data.progress.positionSeconds, 35)
assert.equal(prep.data.subtitles.cues[0].text, "caption")
assert.equal(assets[0].playableLoads, 1)
assert.equal(prep.takeAsset(detail, { url: "https://media.test/720p.mp4" }), undefined, "Other qualities cannot consume default asset")
const claimed = prep.takeAsset(detail, source)
assert.equal(claimed, assets[0])
prep.dispose()
assert.equal(claimed.disposals, 0, "Page cleanup cannot dispose a claimed player resource")
claimed.dispose()
const second = new MissAVPlaybackPreparation({ videoCode: "ABC-002" })
for (let i = 0; i < 10; i++) await Promise.resolve()
finishProgress(null); finishSubtitles(null); await second.ready
second.prepareSource(detail)
enabled = false; await second.refreshSubtitles()
assert.equal(second.data.subtitles, null)
second.releaseAsset(); second.releaseAsset()
assert.equal(assets[1].disposals, 1, "Unused resources are released once")
second.dispose()
console.log("PASS: concurrent local data, lazy media preparation, same-asset transfer, quality isolation and lifecycle cleanup")
