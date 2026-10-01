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
const source = { url: "https://media.example.test/video.mp4", type: "mp4", label: "1080p", qualityHeight: 1080 }
let timerId = 0
let player
let presented
let dismiss
let dismissCount = 0
const hookContexts = new Map()
let hookContext

const jsx = (type, props) => ({ type, props: props || {} })
const scripting = {
  ...Object.fromEntries(["AVPlayerView", "VideoPlayer", "Button", "HStack", "Image", "Spacer", "Text", "VStack", "ZStack"].map(name => [name, name])),
  Device: { supportedInterfaceOrientations: ["portrait"] },
  Navigation: {
    useDismiss: () => () => { dismissCount += 1; dismiss() },
    present: request => { presented = request.element; return new Promise(resolve => { dismiss = resolve }) },
  },
  useObservable: () => ({}),
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
    if (specifier === "./storage") return { loadMissAVPlaybackProgress: async () => ({ positionSeconds: 8, durationSeconds: 100 }), recordMissAVPlayback: async () => {}, saveMissAVPlaybackProgress: async () => {} }
    const target = resolve(dirname(path), specifier)
    return load(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`)
  }
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports)
  return module.exports
}

function children(node) {
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
  return node.type === "Text" ? children(node) : children(node).flatMap(texts)
}

function renderOverlay(overlay) {
  renderComponent(overlay) // Commit initial effect/state updates, then read updated tree.
  return renderComponent(overlay)
}

function tickCaptions() {
  for (const timer of timers.values()) if (timer.delay === 250) timer.callback()
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
  globalThis.Dialog = { alert: async value => { throw new Error(value.message) } }
  globalThis.setInterval = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.setTimeout = globalThis.setInterval
  globalThis.clearInterval = id => timers.delete(id)
  globalThis.clearTimeout = globalThis.clearInterval

  const subtitles = load("subtitles.ts")
  const { chooseAndPresentMissAVPlayer } = load("player.tsx")
  const downloaded = "1\n00:00:01,000 --> 00:00:03,000\n第一句对白\n\n2\n00:00:08,000 --> 00:00:12,000\n第二句对白"
  assert.equal(await subtitles.saveMissAVSubtitle("FNS-258", downloaded), 2)
  subtitles.setMissAVSubtitleEnabled("FNS-258", true)
  assert.equal((await subtitles.loadMissAVSubtitle(" fns-258 ")).cues.length, 2, "Import and playback must use the same normalized file path")

  const playback = chooseAndPresentMissAVPlayer({ videoCode: "FNS-258" }, source)
  await waitForPresentation(playback)
  assert.equal(presented.props.subtitles.cues.length, 2, "Downloaded subtitles must reach the presented player")
  assert.equal(player.currentTime, 8, "Resume must use video time, not elapsed timer time")
  const modal = renderComponent(presented)
  assert.equal(modal.type, "VStack", "Header and video must use separate layout rows, not overlap in a ZStack")
  assert.equal(modal.props.spacing, 0)
  assert.equal(children(modal).length, 2, "Both subtitle modes must reserve exactly one header before the video")
  const header = children(modal)[0]
  assert.equal(renderOverlay(header).props.frame.height, 52, "Close control must have a dedicated fixed-height row")
  const video = find(modal, "VideoPlayer")
  assert.equal(children(modal)[1], video, "Video must be the second row, below the close control")
  assert.notEqual(video.props.ignoresSafeArea, true, "Video must not escape the reserved safe-area layout")
  assert.ok(video?.props.overlay, "Captions must be hosted by the native VideoPlayer.overlay, not its outer sibling")
  const overlay = video.props.overlay
  let tree = renderOverlay(overlay)
  assert.ok(texts(tree).includes("第二句对白"), "Resume must immediately show the matching dialogue")
  assert.ok(texts(renderOverlay(header)).includes("字幕已加载 · 2 条"), "Header must confirm the loaded cue count")
  assert.equal(find(tree, "Button"), undefined, "Close control must never be placed over native video controls")
  assert.equal(find(tree, "Text").props.lineLimit, 1)
  player.currentTime = 2
  tickCaptions()
  assert.ok(texts(renderOverlay(overlay)).includes("第一句对白"), "Seeking backward must update captions")
  player.currentTime = 3
  tickCaptions()
  assert.ok(!texts(renderOverlay(overlay)).includes("第一句对白"), "Gaps must clear expired captions")
  player.currentTime = 9
  tickCaptions()
  const pausedTexts = texts(renderOverlay(overlay))
  tickCaptions()
  assert.deepEqual(texts(renderOverlay(overlay)), pausedTexts, "Pausing must preserve the matching dialogue")
  for (const timer of [...timers.values()]) if (timer.delay === 5000) timer.callback()
  tree = renderOverlay(overlay)
  assert.ok(!texts(renderOverlay(header)).includes("字幕已加载 · 2 条"), "Load notice must disappear without clearing dialogue")
  assert.ok(texts(tree).includes("第二句对白"))
  const closeButton = find(renderOverlay(header), "Button")
  assert.equal(closeButton.props.accessibilityLabel, "关闭播放器")
  assert.deepEqual(closeButton.props.frame, { width: 44, height: 44 }, "Close hit target must remain accessible")
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
  const plainModal = renderComponent(presented)
  assert.equal(plainModal.type, "VStack")
  assert.equal(children(plainModal).length, 2)
  assert.equal(renderOverlay(children(plainModal)[0]).props.frame.height, 52)
  assert.ok(find(plainModal, "AVPlayerView"), "No-subtitle playback must retain native PiP-capable player")
  assert.equal(find(plainModal, "AVPlayerView").props.allowsPictureInPicturePlayback, true)
  assert.notEqual(find(plainModal, "AVPlayerView").props.ignoresSafeArea, true)
  assert.ok(find(plainModal, "Button"), "No-subtitle playback must retain close control")
  dismiss()
  unmount()
  await withoutSubtitles
  assert.equal(timers.size, 0)
  console.log("PASS: separate close header in both playback modes; native caption overlay; import/resume/seek/gaps/pause/cleanup/PiP")
} finally {
  unmount()
  for (const [name, value] of Object.entries(oldGlobals)) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
}
