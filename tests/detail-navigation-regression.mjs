import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compileProductionModule } from "./production-module.mjs"

const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const requestTypes = await import(compileProductionModule("../request-scope.ts"))
const slots = [], pending = [], alerts = []
let index = 0
const scripting = {
  useState(value) { const i = index++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next }] },
  useRef(value) { const i = index++; return slots[i] ||= { current: value } },
  useObservable(value) { const i = index++; return slots[i] ||= { value, setValue(next) { this.value = next } } },
  useEffect() {},
}
globalThis.Dialog = { alert: async options => { alerts.push(options) } }
const module = { exports: {} }, path = fileURLToPath(new URL("../page/detail-navigation.tsx", import.meta.url))
new Function("require", "module", "exports", babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code)(specifier => {
  if (specifier === "scripting") return scripting
  if (specifier === "scripting/jsx-runtime") return { jsx: () => {}, jsxs: () => {} }
  if (specifier === "../design") return {}
  if (specifier === "../client") return { ...requestTypes, missavClient: { getVideo(video, options) {
    return options.scope.waitFor(new Promise((resolve, reject) => pending.push({ video, resolve, reject })))
  } } }
  throw Error(specifier)
}, module, module.exports)
const render = () => { index = 0; return module.exports.useDetailNavigation() }
const video = n => ({ videoCode: `ABC-${n}`, detailPath: `/cn/abc-${n}` })
const detail = n => ({ watchUrl: `https://missav.ws/cn/abc-${n}`, sources: [{ url: `https://media.test/${n}.mp4` }] })
let nav = render()
const first = nav.open(video(1))
nav = render()
assert.equal(nav.pending.videoCode, "ABC-1")
assert.equal(nav.isPresented.value, false, "No navigation until sources are ready")
await nav.open(video(1))
assert.equal(pending.length, 1, "Repeated taps share preparation")
const second = nav.open(video(2))
pending[0].resolve(detail(1)); await first
assert.equal(render().isPresented.value, false, "Cancelled old selection cannot navigate")
pending[1].resolve(detail(2)); await second
nav = render()
assert.equal(nav.selected.video.videoCode, "ABC-2")
assert.equal(nav.selected.detail.sources[0].url, "https://media.test/2.mp4")
assert.equal(nav.isPresented.value, true)
nav.isPresented.setValue(false)
const cancelled = nav.open(video(3)); render().cancel(); pending[2].resolve(detail(3)); await cancelled
assert.equal(render().isPresented.value, false)
assert.equal(alerts.length, 0)
const failed = render().open(video(4)); pending[3].resolve({ sources: [] }); await failed
assert.equal(render().isPresented.value, false)
assert.equal(alerts.length, 1, "Empty sources leave a recoverable list")
for (const file of ["home", "discover", "search", "recommendations", "library", "detail"]) {
  const text = readFileSync(new URL(`../page/${file}.tsx`, import.meta.url), "utf8")
  assert.match(text, /initialDetail=\{selected\.detail\}/, `${file} passes prepared data`)
  assert.match(text, /detailNavigation\.open\(video\)/)
  assert.doesNotMatch(text, /setSelected\(video\); detailPresented\.setValue\(true\)/)
}
console.log("PASS: prepared navigation; repeated taps, supersession, cancellation, empty-source recovery; all six entrances")
