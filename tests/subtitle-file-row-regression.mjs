// Checks the real TSX structure and actions with mocked Scripting views, not iPhone pixels.
// Pass Playwright's bundled Babel path as argv[2].
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../page/components/subtitle_file_row.tsx", import.meta.url))
const jsx = (type, props) => ({ type, props })
const scripting = Object.fromEntries(["Button", "HStack", "Image", "ProgressView", "Text", "VStack"].map(name => [name, name]))
const module = { exports: {} }
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
new Function("require", "module", "exports", compiled)(specifier => {
  if (specifier === "scripting") return scripting
  if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
  if (specifier === "../../design") return { ACCENT: "systemPink", MIN_HIT_SIZE: 44 }
  throw new Error(`Unexpected dependency: ${specifier}`)
}, module, module.exports)
const { SubtitleFileRow } = module.exports
const downloads = []
const file = { source: "JavSub.ai", id: "zh-cn", language: "简体中文", isFree: true, isDemo: false, details: "完整字幕版本说明" }
const render = (item = file, downloadingId = null) => SubtitleFileRow({ file: item, downloadingId, onDownload: value => downloads.push(value) })
const children = node => [node.props.children].flat().filter(Boolean)
const [left, button] = children(render())

assert.equal(render().type, "HStack")
assert.equal(left.type, "VStack")
assert.equal(children(left)[0].props.children, "简体中文")
assert.equal(button.type, "Button")
assert.equal(button.props.frame.maxWidth, undefined, "The right button must not stretch across the row")
assert.equal(button.props.frame.minHeight, 44, "Keep the minimum touch target")
assert.equal(render().props.padding.vertical, 4)
assert.equal(render().props.frame.height, undefined, "Do not clip larger system text with a fixed row height")
assert.equal(children(left).length, 2)
assert.equal(children(left)[1].props.lineLimit, 1)
assert.match(children(left)[1].props.children, /JavSub.ai.*完整.*免费.*完整字幕版本说明/)
assert.equal(button.props.disabled, false)
assert.equal(children(children(button)[0])[1].props.children, "下载并导入")
button.props.action()
assert.deepEqual(downloads, [file])

const busyButton = children(render(file, "JavSub.ai:zh-cn"))[1]
assert.equal(busyButton.props.disabled, true)
assert.equal(children(children(busyButton)[0])[0].type, "ProgressView")
assert.equal(children(children(busyButton)[0])[1].props.children, "导入中…")
busyButton.props.action()
assert.equal(downloads.length, 1)

const otherSource = { ...file, source: "SubtitleCat", language: "繁体中文", details: "" }
const otherButton = children(render(otherSource, "JavSub.ai:zh-cn"))[1]
assert.equal(otherButton.props.disabled, true)
assert.equal(children(children(otherButton)[0])[0].type, "Image", "A different source with the same ID is not downloading")
otherButton.props.action()
assert.equal(downloads.length, 1)
children(render(otherSource))[1].props.action()
assert.deepEqual(downloads, [file, otherSource])
assert.equal(children(children(render(otherSource))[0]).length, 2)

for (const unavailable of [{ ...file, isFree: false }, { ...file, isDemo: true }]) {
  const previewButton = children(render(unavailable))[1]
  assert.equal(previewButton.props.disabled, true)
  assert.equal(previewButton.props.buttonStyle, "bordered")
  assert.equal(children(children(previewButton)[0])[1].props.children, "仅供预览")
  previewButton.props.action()
  assert.equal(downloads.length, 2)
}

console.log("PASS: compact language-left/action-right rows; 44pt touch target; both sources; busy-state and preview guards")
