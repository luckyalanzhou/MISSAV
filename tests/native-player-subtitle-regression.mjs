// Node 24+ only. Pass the path to Playwright's bundled Babel as argv[2], or install Playwright.
// This verifies the actual TSX wiring with mocked Scripting APIs, not iPhone rendering.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const detailSource = readFileSync(resolve(root, "page/detail.tsx"), "utf8")
assert.match(detailSource, /const associatedCode = props\.videoCode/, "Downloads from a detail page must be associated with that page's video, not an edited search query")
assert.doesNotMatch(detailSource, /const associatedCode = title \|\| props\.videoCode/)
const files = new Map()
const preferences = new Map()
const timers = new Map()
const modules = new Map()
const progressSaves = []
const playbackHeaders = { Referer: "https://example.test/watch", Origin: "https://example.test" }
const assets = []
const audioSessionCalls = []
const source = { url: "https://media.example.test/video.mp4", type: "mp4", label: "1080p", qualityHeight: 1080 }
let timerId = 0
let player
let presented
let dismiss
let mountedModal
const hookContexts = new Map()
let hookContext

const jsx = (type, props, key) => ({ type, props: props || {}, key })
const scripting = {
  Script: { directory: "/mock/scripts/MISSAV/" },
  ...Object.fromEntries(["AVPlayerView", "Button", "ForEach", "Text", "ZStack"].map(name => [name, name])),
  Device: { supportedInterfaceOrientations: ["portrait"] },
  Navigation: {
    present: request => { presented = request.element; return new Promise(resolve => { dismiss = resolve }) },
  },
  useObservable: initial => {
    const index = hookContext.index++
    if (!(index in hookContext.states)) {
      hookContext.states[index] = {
        value: typeof initial === "function" ? initial() : initial,
        writes: 0,
        setValue(value) { this.value = value; this.writes += 1 },
      }
    }
    return hookContext.states[index]
  },
  useEffect: (effect, dependencies) => {
    const index = hookContext.index++
    const previous = hookContext.effects[index]
    if (previous?.dependencies.length === dependencies.length && previous.dependencies.every((item, index) => Object.is(item, dependencies[index]))) return
    previous?.cleanup?.()
    hookContext.effects[index] = { dependencies, cleanup: effect() }
  },
}

function load(relativePath) {
  const path = resolve(root, relativePath)
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }
  modules.set(path, module)
  const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
  const localRequire = specifier => {
    if (specifier === "scripting") return scripting
    if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
    if (specifier === "./client") return { missavClient: { getVideo: async () => ({ sources: [source], title: "测试作品", watchUrl: "https://example.test/watch" }), playbackHeaders: () => playbackHeaders } }
    if (specifier === "./storage") return { loadMissAVPlaybackProgress: async () => ({ positionSeconds: 8, durationSeconds: 100 }), recordMissAVPlayback: async () => {}, saveMissAVPlaybackProgress: async (...args) => { progressSaves.push(args) } }
    const target = resolve(dirname(path), specifier)
    return load(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`)
  }
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports)
  return module.exports
}

function children(node) {
  // Model the documented native ForEach data/builder contract, not actual SwiftUI pixels.
  if (node?.type === "ForEach") return node.props.data.value.map(node.props.builder)
  return [node?.props?.children].flat(Infinity).filter(Boolean)
}

function renderComponent(node) {
  if (!hookContexts.has(node.type)) hookContexts.set(node.type, { states: [], effects: [], index: 0 })
  const previous = hookContext
  hookContext = hookContexts.get(node.type)
  hookContext.index = 0
  try { return node.type(node.props) } finally { hookContext = previous }
}

function unmount() {
  for (const context of hookContexts.values()) for (const effect of context.effects) effect?.cleanup?.()
  hookContexts.clear()
}

function find(node, type) {
  if (!node || typeof node !== "object") return undefined
  if (typeof node.type === "function") return find(renderComponent(node), type)
  if (node.type === type) return node
  for (const child of children(node)) { const result = find(child, type); if (result) return result }
}

function findAll(node, type) {
  if (!node || typeof node !== "object") return []
  if (typeof node.type === "function") return findAll(renderComponent(node), type)
  return [...(node.type === type ? [node] : []), ...children(node).flatMap(child => findAll(child, type))]
}

function texts(node) {
  if (!node || typeof node !== "object") return []
  if (typeof node.type === "function") return texts(renderComponent(node))
  return node.type === "Text" ? (node.props.styledText ? [node.props.styledText.content] : children(node)) : children(node).flatMap(texts)
}

function renderOverlay(overlay) {
  renderComponent(overlay) // Commit initial effect/state updates, then read updated tree.
  return renderComponent(overlay)
}

function currentCaption() {
  // Keep the originally presented tree: caption updates must not require replaying
  // the parent function or re-presenting/replacing AVPlayerView.
  const modal = mountedModal
  const surface = find(modal, "ZStack")
  const video = find(surface, "AVPlayerView")
  const overlay = children(surface)[1]
  assert.equal(children(surface)[0], video)
  assert.ok(children(surface).length >= 2, "Caption must be layered after the native video")
  assert.equal(video.props.overlay, undefined, "Do not rely on a separately bridged native video overlay")
  assert.equal(overlay.type, "ZStack")
  assert.equal(overlay.props.alignment, "bottom", "Caption position must not depend on Spacer sizing")
  assert.equal(overlay.props.frame.alignment, "bottom", "Expanded caption frame must not center its intrinsic ZStack")
  assert.deepEqual(overlay.props.padding, { horizontal: 56, bottom: 25 }, "Caption must stay 25 points above the bottom")
  assert.equal(find(overlay, "Spacer"), undefined)
  const binding = find(overlay, "ForEach")
  assert.ok(binding, "Caption must use the native observable ForEach data binding")
  assert.ok(binding.props.data.value.length <= 1, "Single-line caption must show at most one matched cue")
  const caption = find(overlay, "Text")
  if (caption) {
    assert.equal(caption.type, "Text")
    assert.equal(caption.key, binding.props.data.value[0].id, "Cue identity must reach the native Text key")
    assert.equal(caption.props.opacity, undefined, "Matched captions must not inherit a hidden initial opacity")
    assert.equal(caption.props.styledText.content, binding.props.data.value[0].text)
    assert.equal(caption.props.styledText.font, 27, "Caption font must stay fixed at 27 points")
    assert.equal(caption.props.styledText.foregroundColor, "white")
    assert.equal(caption.props.styledText.strokeColor, "black")
    assert.equal(caption.props.styledText.strokeWidth, -4, "Native attributed text must fill white glyphs and draw the black outline")
    assert.equal(caption.props.background, undefined, "Outlined subtitle must not retain the black background box")
    assert.equal(caption.props.clipShape, undefined)
    assert.deepEqual(caption.props.padding, { horizontal: 4 }, "Text must not add extra vertical spacing to the fixed bottom position")
    assert.equal(caption.props.lineLimit, 1)
    assert.equal(caption.props.minScaleFactor, 0.8)
    assert.equal(caption.props.frame.alignment, "center")
  }
  assert.equal(video.props.player, player, "Cue updates must retain the same AVPlayer instance")
  return { overlay, caption, binding }
}

function fireTimers(delay) {
  // Real setTimeout is one-shot; remove it before callbacks schedule the next tick.
  // Iterate a snapshot so a newly scheduled timeout does not fire immediately.
  for (const [id, timer] of [...timers]) {
    if (timer.delay !== delay || !timers.has(id)) continue
    timers.delete(id)
    timer.callback()
  }
}

function tickCaptions() {
  fireTimers(250)
}

async function waitForPresentation(playback) {
  for (let attempt = 0; attempt < 50 && !presented; attempt += 1) await Promise.resolve()
  if (!presented) { await playback; assert.fail("Playback did not present a player") }
}

const oldGlobals = Object.fromEntries(["FileManager", "Storage", "AVPlayer", "AVAsset", "SharedAudioSession", "Dialog", "setInterval", "clearInterval", "setTimeout", "clearTimeout"].map(name => [name, globalThis[name]]))
try {
  globalThis.FileManager = { documentsDirectory: "/mock/documents/", exists: async path => files.has(path), createDirectory: async () => {}, writeAsString: async (path, content) => files.set(path, content), readAsString: async path => files.get(path), rename: async (path, target) => { assert.ok(files.has(path)); assert.ok(!files.has(target)); files.set(target, files.get(path)); files.delete(path) }, remove: async path => { assert.match(path, /\.srt\.(pending|previous)$/); files.delete(path) } }
  globalThis.Storage = { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) }
  globalThis.AVAsset = class {
    constructor(url, options) { this.source = url; this.options = options; assets.push(this) }
    dispose() { this.disposed = true }
  }
  globalThis.AVPlayer = class {
    currentTime = 0
    duration = 100
    timeControlStatus = "paused"
    sourceLoads = 0
    setSource(source, ...options) { this.sourceLoads += 1; this.source = source; this.sourceOptions = options; player = this; this.onReadyToPlay(); return true }
    play() { this.timeControlStatus = "playing"; this.onTimeControlStatusChanged?.(this.timeControlStatus) }
    pause() { this.timeControlStatus = "paused"; this.onTimeControlStatusChanged?.(this.timeControlStatus) }
    stop() {}
    dispose() { this.disposed = true }
  }
  globalThis.SharedAudioSession = {
    setCategory(...args) { audioSessionCalls.push(["category", ...args]) },
    setActive(...args) { audioSessionCalls.push(["active", ...args]) },
  }
  globalThis.Dialog = { alert: async value => { throw new Error(value.message) } }
  // Scripting only guarantees setTimeout/clearTimeout. Node's interval APIs must
  // not make an unsupported host API accidentally pass the playback tests.
  globalThis.setInterval = undefined
  globalThis.clearInterval = undefined
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = id => timers.delete(id)

  const { startPlaybackPolling } = load("playback-polling.ts")
  let pollingCalls = 0
  const stopPolling = startPlaybackPolling(() => { pollingCalls += 1 }, 125)
  for (let tick = 0; tick < 3; tick += 1) fireTimers(125)
  assert.equal(pollingCalls, 3, "Timeout-only host must continue polling beyond its first tick")
  assert.equal(timers.size, 1, "Polling must retain only one pending timeout")
  const queuedCallback = [...timers.values()][0].callback
  stopPolling()
  stopPolling()
  queuedCallback() // Simulate an already-queued callback racing with dismissal.
  assert.equal(pollingCalls, 3)
  assert.equal(timers.size, 0, "Cancelled/racing callbacks must not restart polling")
  let cancelDuringCallback
  cancelDuringCallback = startPlaybackPolling(() => cancelDuringCallback(), 125)
  fireTimers(125)
  assert.equal(timers.size, 0, "Cancellation inside a callback must prevent rescheduling")
  let failingCalls = 0
  const stopFailing = startPlaybackPolling(() => { if (++failingCalls === 1) throw new Error("transient polling error") }, 125)
  assert.throws(() => fireTimers(125), /transient polling error/)
  fireTimers(125)
  assert.equal(failingCalls, 2, "Transient errors must not permanently stop the next timeout")
  stopFailing()
  assert.equal(timers.size, 0)

  const subtitles = load("subtitles.ts")
  const { chooseAndPresentMissAVPlayer } = load("player.tsx")
  const downloaded = "1\n00:00:01,000 --> 00:00:03,000\n第一句对白\n\n2\n00:00:08,000 --> 00:00:12,000\n第二句对白\n\n3\n00:01:10,570 --> 00:01:12,370\n担心的话你也一起来吧?"
  subtitles.setMissAVSubtitleEnabled("FNS-258", false)
  assert.equal(await subtitles.saveMissAVSubtitle("FNS-258", downloaded), 3)
  assert.equal(subtitles.isMissAVSubtitleEnabled("FNS-258"), true, "Saving a subtitle must associate and enable it automatically")
  assert.equal((await subtitles.loadMissAVSubtitle(" fns-258 ")).cues.length, 3, "Import and playback must use the same normalized file path")

  const playback = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source)
  await waitForPresentation(playback)
  assert.deepEqual(audioSessionCalls.slice(0, 2), [["category", "playback", []], ["active", true]], "Playback must not use defaultToSpeaker with the playback category")
  assert.equal(player.source, assets[0], "Authenticated stream must be passed to AVPlayer as an AVAsset")
  assert.equal(player.sourceOptions.length, 0, "AVPlayer.setSource receives one source argument")
  assert.equal(assets[0].source, source.url)
  assert.deepEqual(assets[0].options, { headers: playbackHeaders }, "Playback request headers must reach AVAsset")
  assert.equal(presented.props.subtitles.cues.length, 3, "Downloaded subtitles must reach the presented player")
  assert.equal(player.currentTime, 8, "Resume must use video time, not elapsed timer time")
  const modal = renderOverlay(presented)
  mountedModal = modal
  assert.equal(modal.type, "ZStack", "Use the AVPlayerView directly without a redundant navigation close bar")
  assert.equal(modal.props.background, "black")
  assert.equal(modal.props.preferredColorScheme, "dark")
  assert.equal(modal.props.ignoresSafeArea, true)
  assert.equal(modal.props.statusBarHidden, true)
  const surface = modal
  const video = find(surface, "AVPlayerView")
  assert.equal(children(surface)[0], video)
  assert.equal(video.props.videoGravity, undefined, "Leave aspect ratio handling to AVPlayerView native defaults")
  assert.equal(video.props.allowsPictureInPicturePlayback, false, "Custom page captions cannot follow native PiP")
  assert.equal(video.props.ignoresSafeArea, true)
  let current = currentCaption()
  assert.ok(texts(current.overlay).includes("第二句对白"), "Resume must immediately show the matching dialogue")
  assert.equal(find(current.overlay, "Button"), undefined, "Caption overlay must not contain app controls")
  assert.equal(current.caption.props.lineLimit, 1)
  assert.equal(findAll(surface, "Button").length, 0, "Playback surface must not add a custom close or subtitle-settings button")
  assert.equal(find(modal, "Button"), undefined, "Do not duplicate AVPlayerView's native close control with an app button")
  assert.ok(texts(currentCaption().overlay).includes("第二句对白"))
  assert.equal(find(mountedModal, "AVPlayerView").props.player, player)
  player.play()
  const resumedKey = current.caption.key
  player.currentTime = 0
  tickCaptions()
  assert.equal(currentCaption().caption, undefined, "Native binding must remove captions before the first dialogue")
  player.currentTime = 2
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("第一句对白"), "Seeking backward must update the native overlay props")
  assert.notEqual(currentCaption().caption.key, resumedKey, "Seeking to another cue must change native row identity")
  player.currentTime = 3
  tickCaptions()
  assert.ok(!texts(currentCaption().overlay).includes("第一句对白"), "Gaps must clear expired captions")
  assert.equal(currentCaption().caption, undefined, "Gaps must remove native text rather than retain an invisible node")
  player.currentTime = 9
  tickCaptions()
  const pausedTexts = texts(currentCaption().overlay)
  const pausedWrites = currentCaption().binding.props.data.writes
  tickCaptions()
  assert.deepEqual(texts(currentCaption().overlay), pausedTexts, "Pausing must preserve the matching dialogue")
  assert.equal(currentCaption().binding.props.data.writes, pausedWrites, "The same cue must not rebuild every 250 ms")
  assert.ok(texts(currentCaption().overlay).includes("第二句对白"))
  // Reproduce the user's 71.26-second screenshot after an initially empty cue.
  player.currentTime = 0
  tickCaptions()
  assert.equal(currentCaption().caption, undefined)
  player.currentTime = 71.26
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("担心的话你也一起来吧?"))
  assert.equal(currentCaption().caption.props.styledText.font, 27)
  assert.equal(currentCaption().overlay.props.padding.bottom, 25)
  assert.equal([...timers.values()].filter(timer => timer.delay === 250).length, 1, "Each one-shot subtitle timeout must schedule exactly one successor")
  fireTimers(5000)
  for (let attempt = 0; attempt < 50 && !progressSaves.some(args => args.includes(71.26)); attempt += 1) await Promise.resolve()
  assert.ok(progressSaves.some(args => args.includes(71.26)), "Progress must keep saving while playing without interval APIs")

  const { installMissAVLifecycle } = load("lifecycle.ts")
  let minimize, resume
  const removeLifecycle = installMissAVLifecycle({
    onMinimize: callback => { minimize = callback; return () => {} },
    onResume: callback => { resume = callback; return () => {} },
  })
  player.currentTime = 75
  player.pause()
  assert.equal([...timers.values()].filter(timer => timer.delay === 5000).length, 0, "Pause saves immediately and stops redundant progress polling")
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.ok(progressSaves.some(args => args.includes(75)))
  player.currentTime = 80
  tickCaptions()
  assert.equal(currentCaption().caption, undefined, "Paused seeks still update subtitles")
  minimize()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.ok(progressSaves.some(args => args.includes(80)), "Minimize captures the live position without reloading the site")
  resume({ resumeFromMinimized: true })
  player.play(); player.play()
  assert.equal([...timers.values()].filter(timer => timer.delay === 5000).length, 1)
  const lateReady = player.onReadyToPlay, lateStatus = player.onTimeControlStatusChanged

  dismiss() // The mocked presentation completes when the native player closes on-device.
  unmount()
  assert.equal((await playback).opened, true)
  assert.equal(timers.size, 0, "Dismiss must clear caption and progress timers")
  assert.equal(player.disposed, true)
  assert.equal(assets[0].disposed, true, "The AVAsset must be released after the native player closes")
  assert.deepEqual(scripting.Device.supportedInterfaceOrientations, ["portrait"])
  const savedCount = progressSaves.length
  lateReady(); lateStatus("playing"); minimize(); resume({ resumeFromMinimized: true })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(progressSaves.length, savedCount)
  assert.equal(timers.size, 0, "Late native/lifecycle callbacks cannot revive a dismissed player")
  removeLifecycle()

  presented = undefined
  subtitles.setMissAVSubtitleEnabled("FNS-258", false)
  const withoutSubtitles = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source)
  await waitForPresentation(withoutSubtitles)
  assert.equal(presented.props.subtitles, undefined)
  const plainModal = renderOverlay(presented)
  assert.equal(plainModal.type, "ZStack")
  const plainSurface = plainModal
  assert.equal(children(plainSurface).length, 1, "No-subtitle playback must not create a caption layer")
  assert.ok(find(plainModal, "AVPlayerView"), "No-subtitle playback must retain native PiP-capable player")
  assert.equal(find(plainModal, "AVPlayerView").props.allowsPictureInPicturePlayback, true)
  assert.equal(find(plainModal, "AVPlayerView").props.ignoresSafeArea, true)
  assert.equal(find(plainModal, "Button"), undefined, "No-subtitle playback must also avoid an app-added close button")
  mountedModal = plainModal
  assert.equal(find(mountedModal, "AVPlayerView").props.videoGravity, undefined)
  player.onEnded()
  assert.equal([...timers.values()].filter(timer => timer.delay === 5000).length, 0, "Playback end must stop the recurring progress timeout")
  dismiss()
  unmount()
  await withoutSubtitles
  assert.equal(timers.size, 0)

  presented = undefined
  const preview = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source, { subtitles: subtitles.MISSAV_SUBTITLE_PREVIEW, preview: true })
  await waitForPresentation(preview)
  mountedModal = renderOverlay(presented)
  assert.equal(find(mountedModal, "AVPlayerView").props.videoGravity, undefined, "Native aspect handling must be used for every playback session")
  assert.equal(player.currentTime, 0)
  assert.equal(currentCaption().caption, undefined)
  player.currentTime = 1.2
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("本地字幕测试：应在横屏底部单行显示"), "Local preview must put its first dialogue into native overlay props")
  player.currentTime = 30
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("暂停时字幕保持，继续播放后按时间更新"), "Local preview must retain visible dialogue after 11.5 seconds")
  assert.ok(currentCaption().caption)
  player.currentTime = 62.6
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("暂停时字幕保持，继续播放后按时间更新"), "The user's 62.60-second preview case must have a native caption node")
  assert.equal(currentCaption().caption.props.styledText.font, 27)
  assert.equal(currentCaption().overlay.props.padding.bottom, 25)
  dismiss()
  unmount()
  await preview
  assert.equal(timers.size, 0)
  console.log("PASS: fixed caption style; no duplicate app close/settings controls; caption polling/cache/preview/resume/seek/PiP")
} finally {
  unmount()
  for (const [name, value] of Object.entries(oldGlobals)) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
}
