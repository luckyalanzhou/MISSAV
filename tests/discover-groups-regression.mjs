// Run with Playwright's bundled Babel path as argv[2]; no iOS host is emulated.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compileProductionModule as compile } from "./production-module.mjs"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
globalThis.Storage = { get: () => undefined, set: () => {} }
const client = await import(compile("../client.ts"))
const states = []
const requests = []
let hook = 0
const state = initial => {
  const index = hook++
  if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
  return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value }]
}
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const scripting = {
  ...Object.fromEntries(["Button", "HStack", "Image", "LazyVGrid", "Menu", "ProgressView", "ScrollView", "ScrollViewReader", "Spacer", "Text", "VStack", "ZStack"].map(name => [name, name])),
  useState: state,
  useRef: initial => state(() => ({ current: initial }))[0],
  useObservable: initial => state(() => ({ value: initial, setValue(value) { this.value = value } }))[0],
  useEffect: () => {},
}
const mockClient = { ...client, missavClient: { searchVideoPage: (params, options) => new Promise((resolve, reject) => requests.push({ params, options, resolve, reject })) } }
const path = fileURLToPath(new URL("../page/discover.tsx", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const module = { exports: {} }
new Function("require", "module", "exports", compiled)(specifier => {
  if (specifier === "scripting") return scripting
  if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
  if (specifier === "../client") return mockClient
  if (specifier === "../design") return { ACCENT: "pink", PAGE_BOTTOM_PADDING: 24, PAGE_PADDING: 16, SECTION_SPACING: 20, PageBackground: "PageBackground" }
  if (specifier === "./detail") return { DetailPage: "DetailPage" }
  if (specifier === "./detail-navigation") return { DetailPreparationStatus: "DetailPreparationStatus", useDetailNavigation: () => ({ selected: null, pending: null, isPresented: { value: false, setValue() {} }, cancel() {}, open() {} }) }
  if (specifier === "./components/media_cards") return { MediaGridCard: "MediaGridCard" }
  if (specifier === "./components/state_view") return { StateView: "StateView" }
  throw new Error(`Unexpected module ${specifier}`)
}, module, module.exports)
function render(props = {}) {
  hook = 0
  const nodes = []
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value?.props) return
    nodes.push(value)
    if (value.type === "ScrollViewReader") visit(value.props.children({ scrollTo: () => {} }))
    else visit(value.props.children)
  }
  visit(module.exports.DiscoverPage({ onHistoryChanged() {}, ...props }))
  return nodes
}
const named = (nodes, name) => nodes.filter(node => (typeof node.type === "function" ? node.type.name : node.type) === name)
const chip = (nodes, title) => named(nodes, "CategoryChip").find(node => node.props.title === title)
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const result = code => ({ items: [{ videoCode: code, title: code, detailPath: `/cn/${code}`, coverUrl: "" }], page: 1, hasNext: true, title: code })
const complete = async code => { requests.at(-1).resolve(result(code)); await settle() }

let nodes = render()
assert.deepEqual(named(nodes, "CategoryChip").map(node => node.props.title), ["中文字幕", "日本 AV", "素人", "无码影片", "亚洲 AV"])
named(nodes, "ScrollView").find(node => node.props.onAppear).props.onAppear()
assert.equal(requests.at(-1).params.collection, "chinese-subtitle")
await complete("chinese-001")
nodes = render()
chip(nodes, "日本 AV").props.action()
assert.equal(requests.at(-1).params.collection, "new")
await complete("new-001")
nodes = render()
assert.equal(named(nodes, "CategoryChip").length, 16)
assert.equal(chip(nodes, "最近更新").props.active, true)
chip(nodes, "新作上市").props.action()
const obsolete = requests.at(-1)
nodes = render()
assert.equal(chip(nodes, "新作上市").props.active, true, "A selection highlights before its network request finishes")
chip(nodes, "无码流出").props.action()
await complete("leak-001")
obsolete.resolve(result("obsolete-001"))
await settle()
nodes = render()
assert.equal(named(nodes, "DiscoverHero")[0].props.video.videoCode, "leak-001", "Late responses cannot replace the selected column")

chip(nodes, "类型").props.action()
requests.at(-1).resolve({ items: [], categories: [{ title: "VR", path: "/dm22/cn/genres/VR" }], page: 1, hasNext: false, title: "类型" })
await settle()
nodes = render()
assert.equal(named(nodes, "Menu").length, 0, "A directory does not use video-list filters")
const directory = named(nodes, "DirectoryContent")[0]
directory.props.onSelect(directory.props.categories[0])
assert.equal(requests.at(-1).params.categoryPath, "/dm22/cn/genres/VR")
await complete("vr-001")
nodes = render()
assert.equal(named(nodes, "Menu").length, 2)
named(nodes, "Button").find(node => node.props.title === "中文字幕").props.action()
assert.equal(requests.at(-1).params.filter, "chinese-subtitle")
assert.equal(requests.at(-1).params.categoryPath, "/dm22/cn/genres/VR", "Filtering stays within the selected category")
await complete("vr-002")
nodes = render()
named(nodes, "Button").find(node => node.props.title === "返回类型").props.action()
assert.equal(requests.at(-1).params.categoryPath, "")
assert.equal(requests.at(-1).params.filter, "")
requests.at(-1).resolve({ items: [], categories: [{ title: "VR", path: "/dm22/cn/genres/VR" }], page: 1, hasNext: false, title: "类型" })
await settle()

for (const [title, collection, count] of [["素人", "siro", 6], ["无码影片", "uncensored-leak", 14], ["亚洲 AV", "madou", 5], ["中文字幕", "chinese-subtitle", 0]]) {
  nodes = render()
  chip(nodes, title).props.action()
  assert.equal(requests.at(-1).params.collection, collection)
  assert.equal(requests.at(-1).params.categoryPath, "")
  assert.equal(requests.at(-1).params.filter, "")
  nodes = render()
  assert.equal(named(nodes, "CategoryChip").length, 5 + count)
  assert.equal(named(nodes, "DiscoverHero").length, 0, "Changing group clears the preceding group's content")
  await complete(`${collection}-001`)
}
for (const [collection, title, sort] of [["new", "最近更新", "published_at"], ["today-hot", "今日热门", "today_views"]]) {
  states.length = 0
  nodes = render({ initialCollection: collection })
  assert.equal(chip(nodes, "日本 AV").props.active, true)
  assert.equal(chip(nodes, title).props.active, true)
  named(nodes, "ScrollView").find(node => node.props.onAppear).props.onAppear()
  assert.equal(requests.at(-1).params.collection, collection)
  assert.equal(requests.at(-1).params.sort, sort)
  await complete(`${collection}-direct`)
}
console.log("MISSAV Browse groups, late responses, directories, filters and direct HomeTab collection entrances passed")
