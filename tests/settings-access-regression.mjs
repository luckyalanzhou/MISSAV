// Execute the real Settings TSX with only native UI/route verification mocked.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const path = fileURLToPath(new URL("../page/settings.tsx", import.meta.url))
const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const button = (nodes, title) => nodes.find(node => node.type === "Button" && node.props.title === title)
const text = nodes => nodes.filter(node => node.type === "Text").map(node => node.props.children).filter(value => typeof value === "string").join("\n")

function harness() {
  const states = []
  const pending = []
  const calls = { accessRefreshed: 0, domainChanged: 0 }
  let hook = 0
  let domain = "https://missav.ws/"
  const scripting = {
    ...Object.fromEntries(["Button", "HStack", "Image", "List", "Picker", "Section", "SecureField", "Text", "TextField", "VStack"].map(name => [name, name])),
    Navigation: { useDismiss: () => () => {} },
    useState: initial => {
      const index = hook++
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value }]
    },
  }
  const module = { exports: {} }
  new Function("require", "module", "exports", compiled)(specifier => {
    if (specifier === "scripting") return scripting
    if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
    if (specifier === "../design") return { ACCENT: "pink" }
    if (specifier === "../access") return { submitMissAVAccess: () => true }
    if (specifier === "../site-verification") return {
      openMissAVSiteVerification: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    }
    if (specifier === "../domain") return {
      getMissAVBaseURL: () => domain,
      getMissAVDomainLabel: value => new URL(value).hostname,
      getMissAVLandingURL: value => `${value}cn/`,
      MISSAV_DOMAIN_OPTIONS: [{ value: "https://missav.ws/", title: "missav.ws" }, { value: "https://missav.ai/", title: "missav.ai" }],
      setMissAVBaseURL: value => { domain = value },
    }
    throw new Error(`Unexpected module ${specifier}`)
  }, module, module.exports)
  return { calls, pending, render() {
    hook = 0
    const nodes = []
    function visit(value) {
      if (Array.isArray(value)) { value.forEach(visit); return }
      if (!value?.props) return
      nodes.push(value)
      visit(value.props.children)
    }
    visit(module.exports.SettingsPage({ onDomainChanged: () => calls.domainChanged++, onAccessVerified: () => calls.accessRefreshed++ }))
    return nodes
  } }
}

const page = harness()
let nodes = page.render()
assert.ok(button(nodes, "验证访问线路"))
assert.equal(nodes.filter(node => node.type === "Button" && node.props.title === "验证访问线路").length, 1)
assert.doesNotMatch(text(nodes), /网站账号|网站收藏|登录|密码/)
assert.equal(nodes.some(node => node.type === "SecureField" || node.type === "TextField"), false)
const accessSection = nodes.find(node => node.type === "Section" && node.props.header?.props.children === "访问站点")
assert.ok(accessSection.props.children.some(child => child?.type === "Button" && child.props.title === "验证访问线路"))
button(nodes, "验证访问线路").props.action()
nodes = page.render()
assert.equal(button(nodes, "正在验证访问线路").props.disabled, true)
assert.equal(nodes.find(node => node.type === "Picker").props.disabled, true)
button(nodes, "正在验证访问线路").props.action()
nodes.find(node => node.type === "Picker").props.onChanged("https://missav.ai/")
assert.equal(page.pending.length, 1, "Busy state prevents another verification")
assert.equal(page.calls.domainChanged, 0, "Do not change origin while verification is pending")
page.pending.at(-1).resolve({ status: "accessible", challengeCompleted: false })
await settle()
nodes = page.render()
assert.equal(page.calls.accessRefreshed, 1)
assert.match(text(nodes), /已检查栏目可访问，本次无需 Cloudflare 验证/)
assert.doesNotMatch(text(nodes), /Cloudflare 验证完成/)
assert.equal(button(nodes, "验证访问线路").props.disabled, false)
button(nodes, "验证访问线路").props.action()
page.pending.at(-1).resolve({ status: "accessible", challengeCompleted: true })
await settle()
nodes = page.render()
assert.equal(page.calls.accessRefreshed, 2)
assert.match(text(nodes), /Cloudflare 验证完成，已检查栏目可访问/)
assert.doesNotMatch(text(nodes), /本次无需 Cloudflare 验证/)
for (const status of ["blocked", "incomplete", "unavailable", "error"]) {
  button(page.render(), "验证访问线路").props.action()
  if (status === "error") page.pending.at(-1).reject(new Error("Fixture verification unavailable"))
  else page.pending.at(-1).resolve({ status, probe: { title: "日本 AV" } })
  await settle()
  nodes = page.render()
  assert.equal(page.calls.accessRefreshed, 2, "Failed/unfinished checks cannot refresh as if verified")
  assert.doesNotMatch(text(nodes), /常用栏目访问正常|Cloudflare 验证完成/)
  assert.ok(button(nodes, "验证访问线路"))
}
nodes.find(node => node.type === "Picker").props.onChanged("https://missav.ai/")
nodes = page.render()
assert.equal(page.calls.domainChanged, 1)
assert.doesNotMatch(text(nodes), /Fixture verification unavailable/)
let opened
globalThis.Safari = { openURL: url => { opened = url; return Promise.resolve() } }
button(nodes, "在 Safari 中打开").props.action()
assert.equal(opened, "https://missav.ai/cn/")
delete globalThis.Safari
console.log("PASS: no account UI; route verification, busy protection, successful refresh and domain reset preserved")
