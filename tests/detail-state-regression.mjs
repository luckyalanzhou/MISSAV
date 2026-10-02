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
let hook = 0, mounted = false, finishDetail, finishFavourite, websiteReads = 0, changed = 0
const video = { videoCode: "fixture-001", title: "Fixture", detailPath: "/cn/fixture-001", coverUrl: "" }
const detail = { ...video, genres: [], sources: [{ label: "1080p", url: "https://media.example/1080p.mp4" }] }
const jsx = (type, props) => ({ type, props: props || {} })
const tags = ["Button", "Divider", "EnvironmentValuesReader", "HStack", "Image", "LazyVStack", "NavigationStack", "ProgressView", "ScrollView", "ScrollViewReader", "Text", "TextField", "VStack", "ZStack"]
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
  if (specifier === "../client") return { ...requestTypes, missavClient: { getVideo: () => new Promise(resolve => { finishDetail = resolve }) } }
  if (specifier === "../account") return { getMissAVAccountSnapshot: () => ({ state: "signedIn" }), getMissAVWebsiteSavedState: async () => { websiteReads++; return { saved: false } } }
  if (specifier === "../storage") return { isMissAVFavourite: () => new Promise(resolve => { finishFavourite = resolve }), rememberMissAVDetail: never }
  if (specifier === "../subtitles") return { hasMissAVSubtitle: async () => false, isMissAVSubtitleEnabled: () => true }
  if (specifier === "./components/state_view") return { StateView: "StateView" }
  if (specifier === "../design") return { PageBackground: "PageBackground", SectionHeading: "SectionHeading" }
  if (["../player", "../subtitlecat", "./components/media_cards", "./components/video_row", "./components/subtitle_file_row"].includes(specifier)) return {}
  throw new Error(`Unexpected detail dependency ${specifier}`)
}, module, module.exports)
function render() {
  hook = 0
  const node = module.exports.DetailPage({ video, onFavouriteChanged() {}, onHistoryChanged() { changed++ } })
  if (!mounted) { mounted = true; effects.forEach(effect => effect()) }
  const nodes = []
  function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return }; if (!node?.props) return; nodes.push(node); visit(node.props.children) }
  visit(node)
  return nodes
}
try {
  render()
  assert.equal(websiteReads, 0, "Website restore must not race the playable detail request")
  finishDetail(detail)
  await settle()
  let nodes = render()
  assert.equal(websiteReads, 1)
  assert.ok(nodes.some(node => node.props.accessibilityLabel === "播放 1080p"), "Play must appear even when history persistence never settles")
  assert.equal(nodes.some(node => node.props.title === "正在获取播放信息"), false)
  assert.equal(changed, 0)
  await new Promise(resolve => timer(resolve, 25))
  nodes = render()
  assert.ok(nodes.some(node => String(node.props.children).includes("本机收藏状态读取失败或超时")), "Local timeout still updates after website state completes")
  finishFavourite(true)
  await settle()
  assert.ok(render().some(node => String(node.props.children).includes("本机收藏状态读取失败或超时")), "A late native read cannot overwrite timeout state")
  // Refresh starts new independent reads and allows recovery.
  const scroll = nodes.find(node => node.type === "ScrollView")
  const refresh = scroll.props.refreshable()
  finishFavourite(false); finishDetail(detail)
  await refresh; await settle()
  assert.equal(render().some(node => String(node.props.children).includes("本机收藏状态读取失败或超时")), false)
  console.log("PASS: detail playback independent of history/SQLite; deferred account read; independent local/account generations; timeout/late-result guard and refresh recovery")
} finally { globalThis.setTimeout = timer }
