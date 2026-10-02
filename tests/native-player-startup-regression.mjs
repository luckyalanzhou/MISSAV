import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const modules = new Map(), assets = [], players = [], timers = new Map()
let nextTimer = 0, mode = "waiting", close, modal, audioFailure
let cleanups = []
const scripting = {
  Device: { supportedInterfaceOrientations: ["portrait"] },
  Navigation: {
    present(options) {
      modal = options.element
      const ownedCleanups = cleanups = []
      const completion = new Promise(resolve => { close = () => { ownedCleanups.splice(0).forEach(cleanup => cleanup()); resolve() } })
      modal.type(modal.props) // Mount native dismissal registration.
      return completion
    },
    useDismiss: () => () => close(),
  },
  useObservable: initial => ({ value: typeof initial === "function" ? initial() : initial, setValue(value) { this.value = value } }),
  useEffect: effect => { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup) },
  ...Object.fromEntries(["AVPlayerView", "ForEach", "Text", "ZStack"].map(tag => [tag, tag])),
}
globalThis.Storage = { get: () => undefined }
globalThis.AVAsset = class { constructor(url, options) { this.source = url; this.options = options; this.disposals = 0; assets.push(this) } dispose() { this.disposals++ } }
globalThis.AVPlayer = class {
  currentTime = 0; duration = 600; timeControlStatus = "paused"; sourceLoads = 0; disposals = 0
  constructor() { players.push(this) }
  setSource(source) {
    this.source = source; this.sourceLoads++
    if (mode === "ready" || String(source?.source ?? source).includes("fresh")) this.onReadyToPlay()
    return true
  }
  play() { this.timeControlStatus = "playing"; this.onTimeControlStatusChanged?.("playing"); return true }
  stop() {} dispose() { this.disposals++ }
}
globalThis.SharedAudioSession = { setCategory() { if (audioFailure) throw Error("OSStatus error -50") }, setActive() {} }
const oldTimer = globalThis.setTimeout, oldClear = globalThis.clearTimeout, oldWarn = console.warn
globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id }
globalThis.clearTimeout = id => timers.delete(id)
console.warn = () => {}
function load(relative) {
  const path = resolve(fileURLToPath(new URL("..", import.meta.url)), relative)
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }; modules.set(path, module)
  new Function("require", "module", "exports", babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)(specifier => {
    if (specifier === "scripting") return scripting
    if (specifier === "scripting/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    const target = resolve(dirname(path), specifier)
    return load(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`)
  }, module, module.exports)
  return module.exports
}
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const request = extra => ({ url: "https://media.test/old.mp4", headers: { Referer: "watch" }, title: "Fixture", providerLabel: "MISSAV", qualityLabel: "1080p", ...extra })
const fire = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback() } }
try {
  const present = load("native-player.tsx").presentNativeOnlinePlayer
  const isExpired = load("playback-startup.ts").isExpiredMissAVPlaybackError
  assert.equal(isExpired("HTTP status 403"), true)
  assert.equal(isExpired("token expired"), true)
  for (const error of ["OSStatus error -50", "unsupported codec", "network disconnected", "buffering timeout"]) assert.equal(isExpired(error), false)

  let refreshes = 0
  const prepared = new AVAsset("https://media.test/old.mp4", {})
  const recovered = present(request({ asset: prepared, refreshSource: async () => { refreshes++; return { url: "https://media.test/fresh.mp4", headers: { Referer: "fresh-watch" } } } }))
  await settle()
  const player = players.at(-1)
  assert.equal(player.source, prepared)
  player.onError("HTTP status 403"); await settle()
  assert.equal(refreshes, 1)
  assert.equal(player.sourceLoads, 2)
  assert.equal(players.length, 1, "Recovery keeps the same native player/view")
  assert.equal(prepared.disposals, 1, "Replaced resource is released")
  const repeatedFailure = assert.rejects(recovered, /HTTP status 403/)
  player.onError("HTTP status 403"); await repeatedFailure
  assert.equal(refreshes, 1, "Never loop source refresh after playback or after a retry")
  assert.equal(player.disposals, 1)
  assert.deepEqual(scripting.Device.supportedInterfaceOrientations, ["portrait"])

  let finishRefresh, retryScope
  const cancelled = present(request({ refreshSource: scope => { retryScope = scope; return new Promise(resolve => { finishRefresh = resolve }) } }))
  await settle()
  const cancelledPlayer = players.at(-1)
  cancelledPlayer.onError("token expired"); await settle()
  close(); await cancelled
  assert.equal(retryScope.cancelled, true)
  finishRefresh({ url: "https://media.test/fresh.mp4" }); await settle()
  assert.equal(cancelledPlayer.sourceLoads, 1, "Dismissal rejects late recovery results")

  const timedOut = present(request())
  const timeoutResult = assert.rejects(timedOut, /视频启动超时/)
  await settle(); fire(18_000); await timeoutResult
  assert.equal(players.at(-1).disposals, 1)
  assert.equal(timers.size, 0, "Timeout/dismissal releases every startup timer")

  audioFailure = true
  const audioAsset = new AVAsset("https://media.test/audio.mp4", {})
  await assert.rejects(present(request({ asset: audioAsset, refreshSource: async () => { refreshes++; throw Error("must not retry audio") } })), /OSStatus/)
  assert.equal(refreshes, 1)
  assert.equal(audioAsset.disposals, 1)
  audioFailure = false

  mode = "ready"
  let finishData
  const lateData = present(request({ playbackData: new Promise(resolve => { finishData = resolve }), subtitleDataPending: true }))
  await settle()
  assert.ok(modal, "Presentation never waits for local data")
  finishData({ progress: { positionSeconds: 75, durationSeconds: 600 }, subtitles: { cues: [{ startSeconds: 70, endSeconds: 80, text: "Late caption" }] } })
  await settle()
  assert.equal(players.at(-1).currentTime, 75, "Late resume joins the player without a startup wait")
  assert.equal(modal.props.subtitleState.track.cues[0].text, "Late caption")
  assert.equal(modal.props.subtitleState.pending, false)
  close(); await lateData
  assert.equal(timers.size, 0)
  assert.ok(assets.every(asset => asset.disposals === 1), "Every claimed/replaced asset has one disposal")
  const diagnostics = load("access-diagnostics.ts").getMissAVAccessDiagnostics().filter(entry => entry.event === "playback")
  assert.ok(diagnostics.some(entry => entry.phase === "playing"))
  assert.ok(diagnostics.some(entry => entry.phase === "startup-timeout"))
  assert.doesNotMatch(JSON.stringify(diagnostics), /old\.mp4|fresh\.mp4|Late caption/)
  console.log("PASS: selected asset reuse, one access-error retry, stable player, cancellation, combined startup deadline, audio isolation, late data and resource cleanup")
} finally { globalThis.setTimeout = oldTimer; globalThis.clearTimeout = oldClear; console.warn = oldWarn }
