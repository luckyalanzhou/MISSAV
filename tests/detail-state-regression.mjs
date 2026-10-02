import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compileProductionModule as compile } from "./production-module.mjs"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const deadline = await import(compile("../request-deadline.ts"))
const requestTypes = await import(compile("../request-scope.ts"))
const detailLoading = await import(compile("../detail-loading.ts"))
const timer = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => timer(callback, delay === 6_000 ? 15 : delay, ...args)
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
const never = () => new Promise(() => {})
const states = [], refs = [], effects = []
let hook = 0, mounted = false, finishDetail, changed = 0, detailReads = 0, detailScope
let initialDetail
const video = { videoCode: "fixture-001", title: "Fixture", detailPath: "/cn/fixture-001", coverUrl: "" }
const detail = { ...video, genres: [], sources: [{ label: "1080p", url: "https://media.example/1080p.mp4" }] }
const jsx = (type, props) => ({ type, props: props || {} })
const tags = ["Button", "Divider", "HStack", "Image", "LazyVStack", "NavigationStack", "ProgressView", "ScrollView", "ScrollViewReader", "Text", "TextField", "VStack", "ZStack"]
const scripting = {
  ...Object.fromEntries(tags.map(tag => [tag, tag])),
  useState: initial => { const i = hook++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value }] },
  useRef: initial => { const i = hook++; return refs[i] ||= { current: initial } },
  useObservable: value => { const i = hook++; return refs[i] ||= { value, setValue(next) { this.value = next } } },
  useEffect: effect => { hook++; if (!mounted) effects.push(effect) },
}
const path = fileURLToPath(new URL("../page/detail.tsx", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const module = { exports: {} }
new Function("require", "module", "exports", compiled)(specifier => {
  if (specifier === "scripting") return scripting
  if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
  if (specifier === "../request-deadline") return deadline
  if (specifier === "../detail-loading") return detailLoading
  if (specifier === "./detail-navigation") return {}
  if (specifier === "../client") return { ...requestTypes, missavClient: { getVideo: (_, options) => {
    detailReads++; detailScope = options.scope
    return options.scope.waitFor(new Promise(resolve => { finishDetail = resolve }))
  } } }
  if (specifier === "../storage") return { rememberMissAVDetail: never }
  if (specifier === "../subtitles") return { hasMissAVSubtitle: async () => false, isMissAVSubtitleEnabled: () => true }
  if (specifier === "./components/state_view") return { StateView: "StateView" }
  if (specifier === "../design") return { PageBackground: "PageBackground", SectionHeading: "SectionHeading" }
  if (["../player", "../subtitlecat", "./components/media_cards", "./components/video_row", "./components/subtitle_file_row"].includes(specifier)) return {}
  throw new Error(`Unexpected detail dependency ${specifier}`)
}, module, module.exports)
function render() {
  hook = 0
  const node = module.exports.DetailPage({ video, initialDetail, onHistoryChanged() { changed++ } })
  if (!mounted) { mounted = true; effects.forEach(effect => effect()) }
  const nodes = []
  function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return }; if (!node?.props) return; nodes.push(node); visit(node.props.children) }
  visit(node)
  return nodes
}
try {
  let initial = render()
  assert.equal(finishDetail, undefined, "Constructing an off-screen destination must not start requests")
  const appear = initial.find(node => node.type === "ScrollView").props.onAppear
  appear(); appear()
  assert.equal(detailReads, 1, "Duplicate native appearance notifications share the visible request")
  finishDetail(detail)
  await settle()
  let nodes = render()
  assert.ok(nodes.some(node => node.props.accessibilityLabel === "播放 1080p"), "Play must appear even when history persistence never settles")
  assert.equal(nodes.some(node => node.props.title === "本地字幕叠层测试"), false, "Production detail must not show the retired subtitle overlay test")
  assert.ok(nodes.some(node => node.props.accessibilityLabel === "按番号搜索字幕 FIXTURE-001"), "Removing the overlay test must retain subtitle search")
  const subtitleButton = () => render().find(node => node.props.accessibilityLabel === "按番号搜索字幕 FIXTURE-001")
  assert.equal(subtitleButton().props.navigationDestination.isPresented, false)
  assert.equal(subtitleButton().props.navigationDestination.content.type, "VStack", "Do not construct the search page before it is requested")
  subtitleButton().props.action()
  assert.equal(subtitleButton().props.navigationDestination.isPresented, true, "Search uses the existing native navigation stack")
  const searchDestination = subtitleButton().props.navigationDestination.content
  assert.equal(searchDestination.type.name, "SubtitleSearchPage")
  assert.equal(searchDestination.props.videoCode, "FIXTURE-001")
  subtitleButton().props.navigationDestination.onChanged(false)
  assert.equal(subtitleButton().props.navigationDestination.content.type, "VStack", "Native back removes the search destination and runs cleanup")
  subtitleButton().props.action()
  subtitleButton().props.navigationDestination.content.props.onClose()
  assert.equal(subtitleButton().props.navigationDestination.isPresented, false, "Successful download can return to detail without dismissing the app")
  assert.equal(nodes.some(node => node.props.title === "正在获取播放信息"), false)
  assert.equal(changed, 0)
  assert.equal(nodes.some(node => typeof node.type === "function" && node.type.name === "FavouriteButton"), false)
  assert.equal(nodes.some(node => String(node.props.children).includes("收藏")), false)
  // Refresh still loads detail, without requesting any local favourites.
  const refresh = nodes.find(node => node.type === "ScrollView").props.refreshable()
  finishDetail(detail)
  await refresh; await settle()
  // An actual disappearance cancels only the visible page request; appearance
  // always restarts it. A late cancelled response cannot replace the new one.
  const page = render().find(node => node.type === "ScrollView")
  const pendingRefresh = page.props.refreshable()
  const oldFinish = finishDetail
  page.props.onDisappear()
  render().find(node => node.type === "ScrollView").props.onAppear()
  const newFinish = finishDetail
  oldFinish({ ...detail, title: "STALE" })
  await pendingRefresh; await settle()
  assert.equal(render().some(node => node.props.children === "STALE"), false)
  newFinish({ ...detail, title: "CURRENT" })
  await settle()
  assert.ok(render().some(node => node.props.children === "CURRENT"))
  const currentPage = render().find(node => node.type === "ScrollView")
  const readsBeforePlayer = detailReads
  currentPage.props.onDisappear()
  render().find(node => node.type === "ScrollView").props.onAppear()
  assert.equal(detailReads, readsBeforePlayer, "Returning from player retains already loaded detail")
  // Cancellation by a verification session while still visible must not
  // leave a spinner or a blank page with no retry action.
  const interruptedRefresh = render().find(node => node.type === "ScrollView").props.refreshable()
  detailScope.cancel()
  await interruptedRefresh; await settle()
  nodes = render()
  assert.equal(nodes.some(node => node.props.title === "正在获取播放信息"), false)
  const retry = nodes.find(node => node.props.title === "刷新失败")
  assert.ok(retry, "A visible interrupted request exposes a retry action")
  retry.props.action()
  finishDetail(detail)
  await settle()
  assert.equal(render().some(node => node.props.title === "刷新失败"), false)
  states.length = 0; refs.length = 0; effects.length = 0; mounted = false
  initialDetail = detail
  const readsBeforePrepared = detailReads
  nodes = render()
  assert.ok(nodes.some(node => node.props.accessibilityLabel === "播放 1080p"), "Prepared detail has resolution on its first render")
  nodes.find(node => node.type === "ScrollView").props.onAppear()
  await settle()
  assert.equal(detailReads, readsBeforePrepared, "Prepared destination never requests detail again on appearance")
  console.log("PASS: native visible-page ownership; duplicate appearance coalescing; late-result guards; return/retry recovery; playback independent of history/SQLite")
} finally { globalThis.setTimeout = timer }
