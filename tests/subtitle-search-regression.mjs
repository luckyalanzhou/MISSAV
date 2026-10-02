// Exercise the real search modal with only the iOS bridge/network mocked.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../page/detail.tsx", import.meta.url))
const source = readFileSync(path, "utf8")
const compiled = babelTransform(source, path, false, [], [], "scripting").code
const jsx = (type, props) => ({ type, props: props || {} })
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const file = { id: "zh-cn", source: "SubtitleCat", language: "简体中文", details: "", downloadURL: "https://www.subtitlecat.com/subs/1/FNS-258.zh-CN.srt", isFree: true, isDemo: false }

function harness() {
  const states = []
  const refs = []
  const effects = []
  const pending = []
  const controllers = []
  const saved = []
  const associated = []
  const previews = []
  const heldDownloads = []
  let holdDownloads = false
  let hook = 0
  let mounted = false
  let dismissed = 0
  class Controller {
    constructor() { controllers.push(this); this.disposed = false }
    dismiss() { this.dismissed = true }
    dispose() { this.disposed = true }
  }
  const scripting = {
    ...Object.fromEntries(["Button", "Divider", "HStack", "Image", "LazyVStack", "NavigationStack", "ProgressView", "ScrollView", "Text", "TextField", "VStack", "ZStack"].map(name => [name, name])),
    Navigation: { useDismiss: () => () => { dismissed++ } },
    QuickLook: { previewText: async content => previews.push(content) },
    useState: initial => {
      const index = hook++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = value }]
    },
    useRef: initial => {
      const index = hook++
      return refs[index] ||= { current: initial }
    },
    useEffect: effect => { if (!mounted) effects.push(effect) },
  }
  const module = { exports: {} }
  new Function("require", "module", "exports", "WebViewController", `${compiled}\nmodule.exports.SearchPage = SubtitleSearchPage;`)(specifier => {
    if (specifier === "scripting") return scripting
    if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
    if (specifier === "../subtitlecat") return {
      searchSubtitleCatFiles: (code, options) => new Promise((resolve, reject) => {
        const request = { code, options, controller: null,
          resolve(result) { request.controller?.dispose(); options.onControllerChange?.(null); resolve(result) },
          reject(error) { request.controller?.dispose(); options.onControllerChange?.(null); reject(error) },
        }
        pending.push(request)
      }),
      downloadSubtitleCatFile: async value => { assert.equal(value, file); return holdDownloads ? new Promise(resolve => heldDownloads.push(resolve)) : "fixture SRT" },
    }
    if (specifier === "../subtitles") return { saveMissAVSubtitle: async (...args) => saved.push(args) }
    if (specifier === "./components/subtitle_file_row") return { SubtitleFileRow: "SubtitleFileRow" }
    if (["../client", "../design", "../player", "../account", "../storage", "./components/media_cards", "./components/state_view", "./components/video_row"].includes(specifier)) return {}
    throw new Error(`Unexpected subtitle-search dependency: ${specifier}`)
  }, module, module.exports, Controller)
  function render() {
    hook = 0
    const nodes = []
    const tree = module.exports.SearchPage({ videoCode: "FNS-258", onDownloaded: code => associated.push(code) })
    function visit(node) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node?.props) return
      nodes.push(node)
      visit(node.props.children)
    }
    visit(tree)
    return nodes
  }
  return { render, pending, controllers, saved, associated, previews,
    holdDownloads() { holdDownloads = true },
    finishDownload() { heldDownloads.shift()("fixture SRT") },
    mount() { render(); mounted = true; return effects.map(effect => effect()) },
    startWebView() { const request = pending.at(-1); request.controller = new Controller(); request.options.onControllerChange(request.controller); return request.controller },
    get dismissed() { return dismissed },
  }
}
const texts = nodes => nodes.filter(node => node.type === "Text").map(node => node.props.children).filter(value => typeof value === "string").join("\n")
const resolveSearch = (page, result = {}) => page.pending.at(-1).resolve({ files: [file], searchResultCount: 1, processedDetailCount: 1, failedDetailCount: 0, ...result })

const page = harness()
page.mount()
assert.equal(page.pending.length, 1, "Search the remaining provider immediately on mount")
assert.equal(page.pending[0].code, "FNS-258")
page.pending[0].options.onProgress({ files: [file], searchResultCount: 3, processedDetailCount: 1, failedDetailCount: 0 })
assert.match(texts(page.render()), /已读取 1\/3/)
assert.ok(page.render().some(node => node.type === "SubtitleFileRow"), "Render partial files before the search finishes")
assert.doesNotMatch(texts(page.render()), /没有找到这个番号/)
resolveSearch(page)
await settle()
assert.equal(page.controllers.length, 0, "Normal searches must not create a WebView")
let nodes = page.render()
assert.match(texts(nodes), /共找到 1 个可下载字幕文件/)
assert.match(texts(nodes), /Subtitle Cat/)
assert.ok(nodes.some(node => node.type === "SubtitleFileRow"))

// Editing the query must not change the video receiving the downloaded subtitle.
nodes.find(node => node.type === "TextField").props.onChanged("OTHER-123")
nodes = page.render()
nodes.find(node => node.type === "TextField").props.onSubmit()
assert.equal(page.pending[1].code, "OTHER-123")
resolveSearch(page, { failedDetailCount: 1, searchResultCount: 2, processedDetailCount: 2 })
await settle()
nodes = page.render()
assert.match(texts(nodes), /部分详情页未能读取/)
nodes.find(node => node.type === "SubtitleFileRow").props.onDownload(file)
await settle()
assert.deepEqual(page.saved, [["FNS-258", "fixture SRT"]])
assert.deepEqual(page.associated, ["FNS-258"])
assert.equal(page.dismissed, 1)

const failed = harness()
failed.mount()
failed.pending[0].reject(new Error("网络暂时不可用"))
await settle()
nodes = failed.render()
assert.match(texts(nodes), /网络暂时不可用/)
assert.match(texts(nodes), /不能据此认定没有字幕/)
assert.ok(nodes.some(node => node.type === "Button" && node.props.title === "重试搜索"))
assert.equal(failed.controllers.length, 0)

const empty = harness()
empty.mount()
resolveSearch(empty, { files: [], searchResultCount: 0 })
await settle()
assert.match(texts(empty.render()), /没有找到这个番号的字幕文件/)

const closed = harness()
closed.mount()
const closedController = closed.startWebView()
closed.render().find(node => node.type === "Button" && node.props.accessibilityLabel === "关闭字幕搜索").props.action()
assert.ok(closedController.dismissed, "Closing search immediately dismisses a visible validation window")
resolveSearch(closed)
await settle()
assert.ok(closed.controllers[0].disposed)
assert.equal(closed.dismissed, 1)
assert.ok(!closed.render().some(node => node.type === "SubtitleFileRow"), "Ignore search responses after closing")

const refreshPage = harness()
refreshPage.mount()
resolveSearch(refreshPage, { metrics: { searchCacheHits: 1, detailCacheHits: 1 } })
await settle()
assert.match(texts(refreshPage.render()), /复用 2 项缓存/)
refreshPage.render().find(node => node.type === "Button" && node.props.title === "刷新搜索").props.action()
assert.equal(refreshPage.pending[1].options.forceRefresh, true, "The refresh action must bypass both cache layers")
resolveSearch(refreshPage)
await settle()

console.log("PASS: single-provider immediate search; results/errors/partial results; query-independent video association; controller cleanup")

const earlyDownload = harness()
earlyDownload.mount()
const early = earlyDownload.pending[0]
early.options.onProgress({ files: [file], searchResultCount: 3, processedDetailCount: 1, failedDetailCount: 0 })
earlyDownload.render().find(node => node.type === "SubtitleFileRow").props.onDownload(file)
assert.ok(early.options.isCancelled(), "Downloading a partial result stops remaining search")
await settle()
assert.deepEqual(earlyDownload.saved, [["FNS-258", "fixture SRT"]])
early.options.onProgress({ files: [], searchResultCount: 3, processedDetailCount: 3, failedDetailCount: 0 })
assert.ok(earlyDownload.render().some(node => node.type === "SubtitleFileRow"), "Late progress must not clear downloaded results")
resolveSearch(earlyDownload, { files: [] })
await settle()

const previewPage = harness()
previewPage.mount(); resolveSearch(previewPage); await settle()
previewPage.render().find(node => node.type === "SubtitleFileRow").props.onPreview(file)
await settle()
assert.deepEqual(previewPage.previews, ["fixture SRT"])
assert.deepEqual(previewPage.saved, [], "Text preview does not save or associate a subtitle")
assert.equal(previewPage.dismissed, 0, "Closing QuickLook leaves the search page open")
const downloadTwice = previewPage.render().find(node => node.type === "SubtitleFileRow").props.onDownload
downloadTwice(file); downloadTwice(file)
await settle()
assert.equal(previewPage.saved.length, 1, "Guard repeated taps before the next native render")
assert.deepEqual(previewPage.associated, ["FNS-258"])
console.log("PASS: native text preview without saving, query-independent import, double-tap guard")

for (const action of ["onDownload", "onPreview"]) {
  const late = harness()
  late.mount(); resolveSearch(late); await settle(); late.holdDownloads()
  late.render().find(node => node.type === "SubtitleFileRow").props[action](file)
  late.render().find(node => node.type === "Button" && node.props.accessibilityLabel === "关闭字幕搜索").props.action()
  late.finishDownload(); await settle()
  assert.deepEqual(late.saved, [], "A dismissed search page must not associate late download results")
  assert.deepEqual(late.previews, [], "A late result must not open QuickLook after dismissal")
  assert.equal(late.dismissed, 1)
}
console.log("PASS: late download/preview results are ignored after the search page closes")
