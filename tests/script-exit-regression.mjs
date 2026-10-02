// Execute the real entry/root UI with a mocked iOS bridge; not device validation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const root = fileURLToPath(new URL("../", import.meta.url))
const jsx = (type, props) => ({ type, props: props || {} })

function execute(file, dependencies, testConsole) {
  const path = resolve(root, file)
  const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
  const module = { exports: {} }
  new Function("require", "module", "exports", "console", compiled)(specifier => {
    if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
    assert.ok(specifier in dependencies, `Unexpected dependency ${specifier}`)
    return dependencies[specifier]
  }, module, module.exports, testConsole || console)
  return module.exports
}

function scenario(failure) {
  const calls = []
  let presentation, resolvePresentation, rejectPresentation
  const Script = {
    enableMinimize: () => { calls.push("enable"); if (failure === "setup") throw new Error("setup") },
    exit: () => { calls.push("exit") },
  }
  execute("index.tsx", {
    scripting: { Script, Navigation: { present: options => {
      presentation = options
      return new Promise((resolve, reject) => { resolvePresentation = resolve; rejectPresentation = reject })
    } } },
    "./page": { HomePage: "HomePage" },
    "./database": { getMissAVDatabase: () => Promise.resolve({}) },
    "./lifecycle": { installMissAVLifecycle: () => () => {
      calls.push("cleanup")
      if (failure === "cleanup") throw new Error("cleanup")
    } },
    "./listing-cache": { installMissAVListingCache: () => { if (failure === "cache") throw new Error("cache") } },
    "./listing-cache-db": { missavListingCacheDatabase: {} },
  }, { error: () => calls.push("error"), present: () => { throw new Error("Must not hold exit open behind console") } })
  return { calls, presentation, resolve: resolvePresentation, reject: rejectPresentation }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

const normal = scenario()
assert.equal(normal.calls.includes("exit"), false, "Opening the root must not exit")
normal.presentation.element.props.onClose()
assert.deepEqual(normal.calls, ["enable", "cleanup", "exit"], "X cleans up and exits without waiting for presentation dismissal")
normal.presentation.element.props.onClose()
normal.resolve()
await tick()
assert.equal(normal.calls.filter(call => call === "exit").length, 1, "Repeated close/presentation completion must not exit twice")

const nativeDismiss = scenario()
nativeDismiss.resolve()
await tick()
assert.deepEqual(nativeDismiss.calls, ["enable", "cleanup", "exit"])
for (const failure of ["setup", "cache", "cleanup", "presentation"]) {
  const state = scenario(failure)
  if (failure === "cleanup") state.presentation.element.props.onClose()
  if (failure === "presentation") state.reject(new Error("presentation"))
  await tick()
  assert.equal(state.calls.filter(call => call === "exit").length, 1, `${failure} cannot prevent exit`)
  assert.ok(state.calls.includes("error"))
}

let ready = true, minimized = false, minimizeCalls = 0, closeCalls = 0
const tags = ["Button", "Image", "NavigationStack", "Tab", "TabView", "Text", "Toolbar", "ToolbarItem"]
const { HomePage } = execute("page/index.tsx", {
  scripting: {
    ...Object.fromEntries(tags.map(tag => [tag, tag])),
    Script: { supportsMinimization: () => true, isMinimized: () => minimized, minimize: async () => { minimizeCalls++; minimized = true } },
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    useObservable: value => ({ value, setValue(next) { this.value = next } }),
  },
  "../access": { isMissAVAccessReady: () => ready },
  "./home": { MediaHomePage: "MediaHomePage" },
  "./discover": { DiscoverPage: "DiscoverPage" },
  "./library": { LibraryPage: "LibraryPage" },
  "./search": { SearchPage: "SearchPage" },
  "./settings": { SettingsPage: "SettingsPage" },
  "./access_gate": { AccessGate: "AccessGate" },
})
function find(node, label) {
  if (node?.props?.accessibilityLabel === label) return node
  for (const child of [node?.props?.children, node?.props?.toolbar].flat(Infinity).filter(Boolean)) {
    const match = find(child, label)
    if (match) return match
  }
}
const onClose = () => { closeCalls++ }
const page = HomePage({ onClose })
find(page, "最小化浏览器").props.action()
await tick()
assert.equal(minimizeCalls, 1)
assert.equal(closeCalls, 0, "Minimize must not terminate the script")
find(page, "设置").props.action()
assert.equal(closeCalls, 0, "Settings navigation must not terminate the script")
find(page, "关闭并结束 MISSAV 脚本").props.action()
assert.equal(closeCalls, 1)
ready = false
const gate = HomePage({ onClose })
assert.equal(gate.type, "AccessGate")
gate.props.onClose()
assert.equal(closeCalls, 2, "The access gate close must terminate the same root instance")
console.log("PASS: immediate idempotent root exit; native dismiss/error cleanup; access-gate close; minimize/settings do not exit")
