import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compileProductionModule as compile } from "./production-module.mjs"

const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const deadline = await import(compile("../request-deadline.ts"))
const timer = setTimeout, warn = console.warn
globalThis.setTimeout = (callback, delay, ...args) => timer(callback, delay === 2_000 ? 15 : delay, ...args)
console.warn = () => {}
const source = { url: "https://cdn.example/1080p/video.m3u8", label: "1080p", qualityHeight: 1080, type: "application/vnd.apple.mpegurl" }
const detail = { sources: [source], title: "Fixture", watchUrl: "https://missav.ws/cn/abc-001" }
let mode = "normal", presented, historyWrites = 0, optionalReads = 0
const never = () => new Promise(() => {})
const module = { exports: {} }
const path = fileURLToPath(new URL("../player.tsx", import.meta.url))
new Function("require", "module", "exports", babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)(specifier => {
  if (specifier === "./request-deadline") return deadline
  if (specifier === "./native-player") return { presentNativeOnlinePlayer: async options => { presented = options } }
  if (specifier === "./client") return { missavClient: {
    getVideo: async () => { throw Error("Playback must use the prepared detail without fetching again") },
    playbackHeaders: () => ({}),
  } }
  if (specifier === "./playback-source") return { matchFreshMissAVPlaybackSource: () => source }
  if (specifier === "./subtitles") return {
    isMissAVSubtitleEnabled: () => true,
    loadMissAVSubtitle: () => { optionalReads++; return mode === "normal" ? Promise.resolve({ cues: [{ text: "Caption" }] }) : never() },
  }
  if (specifier === "./storage") return {
    loadMissAVPlaybackProgress: () => { optionalReads++; return mode === "normal" ? Promise.resolve({ positionSeconds: 120, durationSeconds: 600 }) : never() },
    recordMissAVPlayback: () => { historyWrites++; return never() },
    saveMissAVPlaybackProgress: async () => {},
  }
  throw Error(`Unexpected import ${specifier}`)
}, module, module.exports)
try {
  const play = module.exports.chooseAndPresentMissAVPlayer
  const video = { videoCode: "abc-001" }
  assert.equal((await play(video, source, { detail })).opened, true)
  assert.equal(presented.resumePositionSeconds, 120)
  assert.equal(presented.subtitles.cues[0].text, "Caption")
  assert.equal(historyWrites, 1, "Unsettled history write does not hold the player")
  const preparedAsset = { source: source.url }
  const readsBeforePrepared = optionalReads
  await play(video, source, { detail, preparation: { data: { subtitles: { cues: [{ text: "Prepared" }] }, progress: { positionSeconds: 42 } }, takeAsset: () => preparedAsset, waitForData: async () => ({ subtitles: null, progress: null }) } })
  assert.equal(presented.asset, preparedAsset)
  assert.equal(presented.resumePositionSeconds, 42)
  assert.equal(presented.subtitles.cues[0].text, "Prepared")
  assert.equal(optionalReads, readsBeforePrepared, "Prepared playback adds no file/SQLite wait")
  mode = "stalled"; presented = undefined
  let watchdog
  try {
    const result = await Promise.race([play(video, source, { detail }), new Promise((_, reject) => { watchdog = timer(() => reject(Error("Optional native reads held the player")), 500) })])
    assert.equal(result.opened, true)
    assert.equal(presented.resumePositionSeconds, undefined)
    assert.equal(presented.subtitles, undefined)
  } finally { clearTimeout(watchdog) }
  assert.equal(typeof presented.onProgress, "function", "Normal playback keeps saving progress")
  assert.equal(typeof presented.refreshSource, "function", "Normal playback retains startup source recovery")
  console.log("PASS: parallel bounded subtitle/resume reads; normal data retained; history never blocks playback")
} finally { globalThis.setTimeout = timer; console.warn = warn }
