// Execute the real Settings TSX with only native UI/account operations mocked.
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

function harness(initialState) {
  const states = []
  const pending = []
  const calls = { accountVerified: 0, accessRefreshed: 0, accountChanged: 0, domainChanged: 0 }
  let hook = 0
  let domain = "https://missav.ws/"
  const snapshot = () => ({ state: initialState, domain, accountLabel: "Fixture account" })
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
    if (specifier === "../account") return {
      getMissAVAccountSnapshot: snapshot,
      loginMissAV: async () => ({ ...snapshot(), state: "signedIn", accountEmail: "fixture@example.test" }),
      openMissAVSiteVerification: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      signOutMissAV: () => { initialState = "signedOut" },
      verifyMissAVAccount: async () => { calls.accountVerified++; return { ...snapshot(), state: "signedIn" } },
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
    visit(module.exports.SettingsPage({ onDomainChanged: () => calls.domainChanged++, onAccessVerified: () => calls.accessRefreshed++, onAccountChanged: () => calls.accountChanged++ }))
    return nodes
  } }
}

for (const state of ["signedOut", "signedIn", "expired", "blocked"]) {
  const page = harness(state)
  const nodes = page.render()
  assert.ok(button(nodes, "验证访问线路"), `${state}: the access button is independent of login state`)
  const accessSection = nodes.find(node => node.type === "Section" && node.props.header?.props.children === "访问站点")
  assert.ok(accessSection.props.children.some(child => child?.type === "Button" && child.props.title === "验证访问线路"))
  assert.equal(nodes.filter(node => node.type === "Button" && node.props.title === "验证访问线路").length, 1)
}

const page = harness("signedIn")
button(page.render(), "验证当前账号").props.action()
await settle()
let nodes = page.render()
assert.equal(page.calls.accountVerified, 1)
assert.equal(page.calls.accessRefreshed, 0, "Validating an account cannot mark browsing routes as verified")
assert.equal(page.pending.length, 0)
assert.match(text(nodes), /栏目访问仍可能需要 Cloudflare 线路验证/)
assert.ok(button(nodes, "验证访问线路"))
button(nodes, "验证访问线路").props.action()
nodes = page.render()
assert.equal(button(nodes, "正在验证访问线路").props.disabled, true)
assert.equal(button(nodes, "验证当前账号").props.disabled, true)
assert.equal(button(nodes, "退出网站账号").props.disabled, true)
assert.equal(nodes.find(node => node.type === "Picker").props.disabled, true)
page.pending.at(-1).resolve({ status: "accessible" })
await settle()
nodes = page.render()
assert.equal(page.calls.accessRefreshed, 1, "Only successful access verification refreshes Home/Browse")
assert.match(text(nodes), /验证通过：常用栏目访问检查通过/)
assert.match(text(nodes), /已登录网站账号/, "Access verification preserves the login state")
assert.equal(button(nodes, "验证访问线路").props.disabled, false)
assert.match(text(nodes), /网站账号会话有效/, "Account and access messages remain independent")

for (const status of ["incomplete", "unavailable", "error"]) {
  button(page.render(), "验证访问线路").props.action()
  if (status === "error") page.pending.at(-1).reject(new Error("Fixture verification unavailable"))
  else page.pending.at(-1).resolve({ status, probe: { title: "日本 AV" } })
  await settle()
  nodes = page.render()
  assert.equal(page.calls.accessRefreshed, 1, "Failed/unfinished checks must not refresh as if verified")
  assert.doesNotMatch(text(nodes), /验证通过：常用栏目/)
  assert.ok(button(nodes, "验证访问线路"))
  assert.match(text(nodes), /已登录网站账号/)
}
nodes.find(node => node.type === "Picker").props.onChanged("https://missav.ai/")
nodes = page.render()
assert.equal(page.calls.domainChanged, 1)
assert.doesNotMatch(text(nodes), /Fixture verification unavailable|网站账号会话有效/, "Switching domains clears old account/access messages")

const login = harness("signedOut")
nodes = login.render()
nodes.find(node => node.type === "TextField").props.onChanged("fixture@example.test")
nodes.find(node => node.type === "SecureField").props.onChanged("fixture-password")
button(login.render(), "登录 MISSAV").props.action()
await settle()
nodes = login.render()
assert.match(text(nodes), /已登录网站账号/)
assert.ok(button(nodes, "验证访问线路"), "The route verification entry remains after login")
assert.equal(login.calls.accountChanged, 1)
assert.equal(login.calls.accessRefreshed, 0)
console.log("PASS: access verification visible for every account state; independent messages, successful refresh and domain reset")
