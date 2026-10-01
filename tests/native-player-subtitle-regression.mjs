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
const files = new Map()
const preferences = new Map()
const timers = new Map()
const modules = new Map()
const progressSaves = []
const source = { url: "https://media.example.test/video.mp4", type: "mp4", label: "1080p", qualityHeight: 1080 }
let timerId = 0
let player
let presented
let dismiss
let dismissCount = 0
let subtitleInfo
let mountedModal
const hookContexts = new Map()
let hookContext

const jsx = (type, props, key) => ({ type, props: props || {}, key })
const scripting = {
  ...Object.fromEntries(["AVPlayerView", "VideoPlayer", "Button", "ForEach", "HStack", "Image", "Spacer", "Text", "VStack", "ZStack"].map(name => [name, name])),
  Device: { supportedInterfaceOrientations: ["portrait"] },
  Navigation: {
    useDismiss: () => () => { dismissCount += 1; dismiss() },
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
  useRef: initial => {
    const index = hookContext.index++
    if (!(index in hookContext.states)) hookContext.states[index] = { current: initial }
    return hookContext.states[index]
  },
  useState: initial => {
    const context = hookContext
    const index = context.index++
    if (!(index in context.states)) context.states[index] = initial
    return [context.states[index], value => { context.states[index] = value }]
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
    if (specifier === "./client") return { missavClient: { getVideo: async () => ({ sources: [source], title: "测试作品", watchUrl: "https://example.test/watch" }), playbackHeaders: () => ({}) } }
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
  return [node?.props?.children].flat().filter(Boolean)
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
  // the parent function or re-presenting/replacing VideoPlayer.
  const modal = mountedModal
  const video = find(modal, "VideoPlayer")
  const overlay = children(modal)[1]
  assert.equal(children(modal)[0], video)
  assert.equal(children(modal).length, 3, "Caption and close control must both follow the video in the visible page ZStack")
  assert.equal(video.props.overlay, undefined, "Do not rely on a separately bridged native video overlay")
  assert.equal(overlay.type, "ZStack")
  assert.equal(overlay.props.alignment, "bottom", "Caption position must not depend on Spacer sizing")
  assert.equal(overlay.props.frame.alignment, "bottom", "Expanded caption frame must not center its intrinsic ZStack")
  assert.deepEqual(overlay.props.padding, { horizontal: 56, bottom: 64 }, "Caption must retain room above the home indicator and transport bar")
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
    assert.equal(caption.props.styledText.foregroundColor, "white")
    assert.equal(caption.props.styledText.strokeColor, "black")
    assert.equal(caption.props.styledText.strokeWidth, -4, "Native attributed text must fill white glyphs and draw the black outline")
    assert.equal(caption.props.background, undefined, "Outlined subtitle must not retain the black background box")
    assert.equal(caption.props.clipShape, undefined)
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

const oldGlobals = Object.fromEntries(["FileManager", "Storage", "AVPlayer", "SharedAudioSession", "Dialog", "setInterval", "clearInterval", "setTimeout", "clearTimeout"].map(name => [name, globalThis[name]]))
try {
  globalThis.FileManager = { documentsDirectory: "/mock/documents/", exists: async path => files.has(path), createDirectory: async () => {}, writeAsString: async (path, content) => files.set(path, content), readAsString: async path => files.get(path) }
  globalThis.Storage = { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) }
  globalThis.AVPlayer = class {
    currentTime = 0
    duration = 100
    setSource() { player = this; this.onReadyToPlay(); return true }
    play() {}
    stop() {}
    dispose() { this.disposed = true }
  }
  globalThis.SharedAudioSession = { setCategory() {}, setActive() {} }
  globalThis.Dialog = { alert: async value => { if (value.title === "字幕信息") subtitleInfo = value; else throw new Error(value.message) } }
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
  assert.equal(await subtitles.saveMissAVSubtitle("FNS-258", downloaded), 3)
  subtitles.setMissAVSubtitleEnabled("FNS-258", true)
  assert.equal((await subtitles.loadMissAVSubtitle(" fns-258 ")).cues.length, 3, "Import and playback must use the same normalized file path")

  const playback = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source)
  await waitForPresentation(playback)
  assert.equal(presented.props.subtitles.cues.length, 3, "Downloaded subtitles must reach the presented player")
  assert.equal(player.currentTime, 8, "Resume must use video time, not elapsed timer time")
  const modal = renderOverlay(presented)
  mountedModal = modal
  assert.equal(modal.type, "ZStack", "Floating close control must not shrink the video with a separate header row")
  assert.equal(modal.props.background, "black")
  assert.equal(modal.props.preferredColorScheme, "dark")
  assert.equal(modal.props.ignoresSafeArea, true, "Black playback root must cover white system safe-area margins")
  assert.equal(modal.props.statusBarHidden, true)
  assert.equal(modal.props.alignment, "leading", "Close control must sit at the side middle, away from top/bottom toolbars")
  const controls = children(modal)[2]
  assert.equal(renderOverlay(controls).props.frame?.height, undefined, "Close control must not reserve a 52-point video header")
  const video = find(modal, "VideoPlayer")
  assert.equal(children(modal)[0], video)
  assert.equal(video.props.ignoresSafeArea, true)
  let current = currentCaption()
  assert.ok(texts(current.overlay).includes("第二句对白"), "Resume must immediately show the matching dialogue")
  assert.ok(texts(renderOverlay(controls)).includes("字幕已加载 · 3 条"))
  assert.equal(find(current.overlay, "Button"), undefined, "Caption overlay must not contain another close button")
  assert.equal(current.caption.props.lineLimit, 1)
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
  fireTimers(5000)
  assert.ok(!texts(renderOverlay(controls)).includes("字幕已加载 · 3 条"), "Load notice must disappear without clearing dialogue")
  assert.ok(texts(currentCaption().overlay).includes("第二句对白"))
  const closeButton = find(renderOverlay(controls), "Button")
  assert.equal(closeButton.props.accessibilityLabel, "关闭播放器")
  assert.deepEqual(closeButton.props.frame, { width: 44, height: 44 }, "Close hit target must remain accessible")
  closeButton.props.contextMenu.menuItems.props.action()
  assert.match(subtitleInfo.message, /当前视频时间：9.00 秒/)
  assert.match(subtitleInfo.message, /第二句对白/)
  assert.match(subtitleInfo.message, /显示路径：原生绑定 \/ 底部对齐/)
  assert.match(subtitleInfo.message, /定时器：递归 setTimeout/)
  assert.match(subtitleInfo.message, /自动采样：[1-9]\d* 次，最近 9.00 秒/)
  assert.match(subtitleInfo.message, /送往显示层：第二句对白/)
  assert.match(subtitleInfo.message, /文本节点构建：第二句对白/)
  // Reproduce the user's 71.26-second screenshot after an initially empty cue.
  player.currentTime = 0
  tickCaptions()
  assert.equal(currentCaption().caption, undefined)
  player.currentTime = 71.26
  tickCaptions()
  assert.ok(texts(currentCaption().overlay).includes("担心的话你也一起来吧?"))
  closeButton.props.contextMenu.menuItems.props.action()
  assert.match(subtitleInfo.message, /最近 71.26 秒/)
  assert.match(subtitleInfo.message, /送往显示层：担心的话你也一起来吧/)
  assert.equal([...timers.values()].filter(timer => timer.delay === 250).length, 1, "Each one-shot subtitle timeout must schedule exactly one successor")
  fireTimers(5000)
  for (let attempt = 0; attempt < 50 && !progressSaves.some(args => args.includes(71.26)); attempt += 1) await Promise.resolve()
  assert.ok(progressSaves.some(args => args.includes(71.26)), "Progress must keep saving while playing without interval APIs")
  closeButton.props.action()
  unmount()
  assert.equal((await playback).opened, true)
  assert.equal(dismissCount, 1)
  assert.equal(timers.size, 0, "Dismiss must clear caption and progress timers")
  assert.equal(player.disposed, true)
  assert.deepEqual(scripting.Device.supportedInterfaceOrientations, ["portrait"])

  presented = undefined
  subtitles.setMissAVSubtitleEnabled("FNS-258", false)
  const withoutSubtitles = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source)
  await waitForPresentation(withoutSubtitles)
  assert.equal(presented.props.subtitles, undefined)
  const plainModal = renderOverlay(presented)
  assert.equal(plainModal.type, "ZStack")
  assert.equal(plainModal.props.ignoresSafeArea, true)
  assert.equal(children(plainModal).length, 2)
  assert.ok(find(plainModal, "AVPlayerView"), "No-subtitle playback must retain native PiP-capable player")
  assert.equal(find(plainModal, "AVPlayerView").props.allowsPictureInPicturePlayback, true)
  assert.equal(find(plainModal, "AVPlayerView").props.ignoresSafeArea, true)
  assert.ok(find(plainModal, "Button"), "No-subtitle playback must retain close control")
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
  const previewControls = children(mountedModal)[2]
  find(renderOverlay(previewControls), "Button").props.contextMenu.menuItems.props.action()
  assert.match(subtitleInfo.message, /最近 62.60 秒/)
  assert.match(subtitleInfo.message, /送往显示层：暂停时字幕保持/)
  dismiss()
  unmount()
  await preview
  assert.equal(timers.size, 0)
  console.log("PASS: bottom-aligned caption frame; native white/black outlined text without background box; timeout-only host/71.26s/import/preview/resume/seek/gaps/pause/cleanup/PiP")
} finally {
  unmount()
  for (const [name, value] of Object.entries(oldGlobals)) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
}
