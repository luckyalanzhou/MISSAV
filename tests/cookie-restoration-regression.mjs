import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

const keychain = new Map(), storage = new Map(), removed = []
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
globalThis.Keychain = { get: key => keychain.get(key), set: (key, value) => keychain.set(key, value), remove: key => { removed.push(key); keychain.delete(key) } }
const session = await import(compile("../cloudflare-session.ts"))
const diagnostics = await import(compile("../access-diagnostics.ts"))
const { MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../request-scope.ts"))
const { missavClient } = await import(compile("../client.ts"))
const key = "missav_cloudflare_cookie_v1_missav_ws"
const accountKey = "missav_account_cookie_v2_missav_ws"
const target = "https://missav.ws/dm23/cn/release?filters=individual&page=2&token=URL_SECRET"
const cookie = (value = "COOKIE_SECRET", extra = {}) => ({ name: "cf_clearance", value, domain: ".missav.ws", path: "/", isSecure: true, isHTTPOnly: true, isSessionOnly: false, expiresDate: new Date(Date.now() + 600_000).toISOString(), ...extra })
const aux = { ...cookie("AUX_SECRET"), name: "__cf_bm" }
const account = { ...cookie("ACCOUNT_SECRET"), name: "missav_session" }
const seed = (cookies = [cookie(), aux]) => { keychain.set(key, JSON.stringify(cookies)); keychain.set(accountKey, "ACCOUNT_SECRET"); removed.length = 0 }
function jar(initial = [], options = {}) {
  return {
    cookies: [...initial], writes: [], reads: [], deletes: 0,
    async getAllCookies() { return [...this.cookies] },
    async getCookies(url) {
      this.reads.push(url)
      if (options.unreadable) throw new Error("RAW_ERROR_SECRET")
      return [...this.cookies] // Production must still validate host/path/expiry.
    },
    async setCookie(value) {
      this.writes.push(value)
      if (options.writeThrows) throw new Error("WRITE_ERROR_SECRET")
      if (options.reject || options.auxOnly && value.name === "cf_clearance") return false
      if (!options.noReadback) this.cookies = [...this.cookies.filter(old => old.name !== value.name || old.path !== value.path), value]
      return true
    },
    async deleteCookie() { this.deletes++; throw new Error("Must not delete native cookies") },
    async clearAllCookies() { this.deletes++; throw new Error("Must not clear shared cookies") },
  }
}
const originalWarn = console.warn, logs = []
console.warn = (...args) => logs.push(args.join(" "))
try {
  seed()
  let store = jar([cookie("LIVE_NEWER"), account])
  let result = await session.restoreCloudflareSessionDetailed(store, target)
  assert.equal(result.state, "live")
  assert.equal(result.clearance, true)
  assert.equal(result.attempted, 0)
  assert.equal(store.writes.length, 0, "A live clearance must not be replaced by an older backup")
  assert.equal(store.reads[0], target, "Read cookies for the exact URL, not only the host")
  assert.ok(result.expiresInSeconds > 0)

  seed()
  store = jar([account])
  result = await session.restoreCloudflareSessionDetailed(store, target)
  assert.deepEqual([result.state, result.attempted, result.accepted, result.confirmed, result.clearance], ["restored", 2, 2, 2, true])
  assert.ok(store.writes[0].expiresDate instanceof Date)
  assert.equal(store.writes[0].name, "cf_clearance")
  assert.ok(store.cookies.includes(account))
  assert.equal(store.deletes, 0)

  for (const options of [{ reject: true }, { writeThrows: true }]) {
    seed(); store = jar([account], options)
    result = await session.restoreCloudflareSessionDetailed(store, target)
    assert.equal(result.state, "rejected")
    assert.equal(result.accepted, 0)
    assert.equal(result.clearance, false)
    assert.equal(await session.restoreCloudflareSession(store, target), 0, "Backup size is not a successful-restore count")
    assert.ok(keychain.has(key), "Transient bridge rejection is not proof that the saved token is invalid")
  }
  for (const options of [{ noReadback: true }, { unreadable: true }]) {
    seed(); store = jar([], options)
    result = await session.restoreCloudflareSessionDetailed(store, target)
    assert.equal(result.state, "unconfirmed")
    assert.equal(result.accepted, 2)
    assert.equal(result.clearance, false)
    assert.equal(await session.restoreCloudflareSession(store, target), 0)
  }
  seed(); store = jar([], { auxOnly: true })
  result = await session.restoreCloudflareSessionDetailed(store, target)
  assert.equal(result.accepted, 1)
  assert.equal(result.confirmed, 1)
  assert.equal(result.clearance, false, "Auxiliary cookies alone cannot prove clearance")
  assert.equal(await session.restoreCloudflareSession(store, target), 0)

  for (const [snapshot, expected] of [
    ["bad JSON COOKIE_SECRET", "invalid"], [JSON.stringify({ cookies: [cookie()] }), "invalid"],
    [JSON.stringify([cookie("expired", { expiresDate: new Date(0) }), aux]), "expired"],
    [JSON.stringify([cookie("wrong", { domain: ".missav.ai" })]), "invalid"],
    [JSON.stringify([aux, account]), "invalid"],
    [JSON.stringify([cookie("invalid-date", { expiresDate: "not-a-date" })]), "expired"],
    [JSON.stringify([cookie("broad", { domain: ".ws" })]), "invalid"],
  ]) {
    keychain.set(key, snapshot); keychain.set(accountKey, "ACCOUNT_SECRET"); removed.length = 0
    store = jar([account])
    result = await session.restoreCloudflareSessionDetailed(store, target)
    assert.equal(result.state, expected)
    assert.equal(store.writes.length, 0)
    assert.deepEqual(removed, [key])
    assert.equal(keychain.get(accountKey), "ACCOUNT_SECRET")
    assert.equal(store.deletes, 0)
  }

  seed([cookie("CN_ONLY", { path: "/cn" })]); store = jar([cookie("LOGIN_ONLY", { path: "/cn/login" })])
  result = await session.restoreCloudflareSessionDetailed(store, "https://missav.ws/cnnew")
  assert.equal(result.state, "scope-mismatch", "Cookie paths use path-segment boundaries")
  assert.equal(store.writes.length, 0)
  assert.ok(keychain.has(key), "A valid cookie for another path should not be discarded")
  result = await session.restoreCloudflareSessionDetailed(store, "https://missav.ws/cn/release")
  assert.equal(result.state, "restored")
  assert.equal(result.confirmed, 1)

  seed(); store = jar([cookie("foreign", { domain: ".missav.ai" }), cookie("expired", { expiresDate: new Date(0) })])
  result = await session.restoreCloudflareSessionDetailed(store, target)
  assert.equal(result.state, "restored", "An expired or other-domain live cookie cannot suppress restoration")
  store = jar()
  result = await session.restoreCloudflareSessionDetailed(store, "https://not-missav.example/cn/")
  assert.equal(result.state, "unsupported")
  assert.equal(store.reads.length + store.writes.length, 0)
  seed([cookie("session", { expiresDate: null, isSessionOnly: true })])
  result = await session.restoreCloudflareSessionDetailed(jar(), target)
  assert.equal(result.state, "restored")
  assert.equal(result.expiresInSeconds, null, "Session-only cookies have no fabricated expiry")

  // Serial restoration: the second controller sees the first controller's
  // verified native write instead of overwriting it with the same backup.
  seed(); store = jar()
  const second = { getCookies: store.getCookies.bind(store), setCookie: store.setCookie.bind(store) }
  const pair = await Promise.all([session.restoreCloudflareSessionDetailed(store, target), session.restoreCloudflareSessionDetailed(second, target)])
  assert.deepEqual(pair.map(value => value.state), ["restored", "live"])
  assert.equal(store.writes.length, 2)

  // Cancel while the native store is pending: no later writes or diagnostics.
  seed(); const scope = new MissAVRequestScope()
  let resume, writes = 0
  const before = diagnostics.getMissAVAccessDiagnostics().length
  const pending = session.restoreCloudflareSessionDetailed({ getCookies: () => new Promise(resolve => { resume = resolve }), setCookie: async () => { writes++; return true } }, target, scope)
  const rejected = assert.rejects(pending, isMissAVRequestCancelled)
  for (let i = 0; i < 20; i++) await Promise.resolve()
  scope.cancel(); await rejected; resume([])
  for (let i = 0; i < 25; i++) await Promise.resolve()
  assert.equal(writes, 0)
  assert.equal(diagnostics.getMissAVAccessDiagnostics().length, before)

  // Bound an unresponsive bridge; do not retry uncertain native writes.
  const nativeTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 2000 ? 5 : delay, ...args)
  try {
    seed(); writes = 0
    result = await session.restoreCloudflareSessionDetailed({ getCookies: async () => [], setCookie: () => { writes++; return new Promise(() => {}) } }, target)
    assert.equal(result.state, "unconfirmed")
    assert.equal(writes, 1)
    assert.equal(result.clearance, false)
    keychain.delete(key)
    result = await session.restoreCloudflareSessionDetailed({ getCookies: () => new Promise(() => {}) }, target)
    assert.equal(result.state, "store-unavailable")
  } finally { globalThis.setTimeout = nativeTimeout }

  seed(); store = jar([cookie(), account])
  assert.equal(await session.captureCloudflareSession(store, target), 1)
  assert.doesNotMatch(keychain.get(key), /ACCOUNT_SECRET/)
  const retained = keychain.get(key)
  assert.equal(await session.captureCloudflareSession(jar([aux, account]), target), 0)
  assert.equal(keychain.get(key), retained, "A page with only auxiliary cookies must not overwrite a valid backup")
  const keychainGet = Keychain.get
  Keychain.get = () => { throw new Error("KEYCHAIN_ERROR_SECRET") }
  try {
    result = await session.restoreCloudflareSessionDetailed(jar(), target)
    assert.equal(result.state, "store-unavailable", "Unavailable Keychain is not a proven missing backup")
  } finally { Keychain.get = keychainGet }

  // Production page diagnostics distinguish a challenge despite an available
  // cookie, without falsely attributing it to an observed IP/network change.
  globalThis.WebViewController = class {
    async getCookies() { return [cookie("LIVE_SECRET")] }
    async getAllCookies() { return [cookie("LIVE_SECRET")] }
    async loadURL(url) { this.url = url; return true }
    async waitForLoad() { return true }
    async evaluateJavaScript() { return { url: this.url, html: '<html><title>Just a moment</title><div id="challenge-form">Verify you are human HTML_SECRET</div></html>' } }
    dispose() {}
  }
  await assert.rejects(missavClient.searchVideoPage({ collection: "release" }, { forceRefresh: true }), /Cloudflare/)
  const page = diagnostics.getMissAVAccessDiagnostics().findLast(entry => entry.event === "page")
  assert.deepEqual([page.state, page.cookieState, page.clearance], ["challenge", "live", true])
  assert.doesNotMatch(JSON.stringify(diagnostics.getMissAVAccessDiagnostics()) + logs.join("\n"), /COOKIE_SECRET|AUX_SECRET|ACCOUNT_SECRET|LIVE_SECRET|HTML_SECRET|URL_SECRET|RAW_ERROR_SECRET|WRITE_ERROR_SECRET|KEYCHAIN_ERROR_SECRET/)

  diagnostics.clearMissAVAccessDiagnostics()
  for (let i = 0; i < 70; i++) diagnostics.recordMissAVAccessDiagnostic("page", `https://missav.ws/cn/search/PRIVATE_TERM?page=2&password=PASSWORD_SECRET`, { state: "normal", elapsedMs: i, cookie: "EXTRA_SECRET", html: "HTML_SECRET", error: "ERROR_SECRET" })
  let history = diagnostics.getMissAVAccessDiagnostics()
  assert.equal(history.length, 60)
  assert.equal(history[0].elapsedMs, 10)
  assert.equal(history[0].route, "cn/search")
  history[0].state = "blocked"
  assert.equal(diagnostics.getMissAVAccessDiagnostics()[0].state, "normal", "Returned diagnostics are snapshots")
  diagnostics.recordMissAVAccessDiagnostic("page", "https://ACCOUNT_SECRET:PASSWORD_SECRET@missav.ws/cn/new", { state: "unavailable" })
  assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).host, "other")
  diagnostics.recordMissAVAccessDiagnostic("page", "https://missav.ws/cn/genres/PRIVATE_TERM", { state: "normal" })
  assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).route, "cn/genres/:category")
  assert.doesNotMatch(JSON.stringify(diagnostics.getMissAVAccessDiagnostics()) + logs.join("\n"), /PRIVATE_TERM|PASSWORD_SECRET|EXTRA_SECRET|ERROR_SECRET|ACCOUNT_SECRET|HTML_SECRET/)
  assert.doesNotMatch(readFileSync(new URL("../cloudflare-session.ts", import.meta.url), "utf8"), /controller\.(?:deleteCookie|clearAllCookies)\(/)
  assert.doesNotMatch(readFileSync(new URL("../client.ts", import.meta.url), "utf8"), /console\.warn\([^\n]*\{ url/)
  console.log("PASS: exact-URL live-cookie priority; write boolean/readback; rejected/partial/unknown restore; expired/corrupt backup cleanup; host/path isolation; serialized restore; cancellation/timeouts; redacted bounded diagnostics")
} finally { console.warn = originalWarn }
