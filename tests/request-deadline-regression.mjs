import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
globalThis.Storage = { get: () => undefined, set: () => {} }
const keychain = new Map()
globalThis.Keychain = { get: key => keychain.get(key) || null, set: (key, value) => keychain.set(key, value) }
const { withMissAVDeadline } = await import(compile("../request-deadline.ts"))
const { installMissAVListingCache, readCachedListing, writeCachedListing } = await import(compile("../listing-cache.ts"))
const { getMissAVWebsiteSavedState } = await import(compile("../account.ts"))
const timer = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => timer(callback, [1_000, 12_000].includes(delay) ? 15 : delay, ...args)
try {
  let cleanups = 0, finish
  await assert.rejects(withMissAVDeadline(new Promise(resolve => { finish = resolve }), 10, "Fixture timeout", () => { cleanups++ }), /Fixture timeout/)
  finish("late")
  assert.equal(cleanups, 1)
  assert.equal(await withMissAVDeadline(Promise.resolve("ok"), 10, "timeout", () => { cleanups++ }), "ok")
  assert.equal(cleanups, 1)
  installMissAVListingCache({ read: () => new Promise(() => {}), write: () => new Promise(() => {}) })
  assert.equal(await readCachedListing("https://missav.ws/cn/new"), null, "Hung SQLite cache must not block online loading")
  await writeCachedListing("https://missav.ws/cn/new", { title: "Listing", page: 1, hasNext: false, items: [{ videoCode: "fixture-001", title: "Fixture", detailPath: "/cn/fixture-001", coverUrl: "" }] }, Date.now())

  const saved = { name: "session", value: "backup", domain: ".missav.ws", path: "/" }
  keychain.set("missav_account_cookie_v2_missav_ws", JSON.stringify([saved]))
  let nativeMode = "normal", view, sets = 0, deletions = 0
  globalThis.WebViewController = class {
    disposed = false
    constructor() { view = this }
    getAllCookies = async () => [{ ...saved, value: "fresh-live" }]
    getCookies = async () => {
      assert.equal(this.disposed, false)
      if (nativeMode === "cookie") return new Promise(resolve => { this.finishCookies = resolve })
      return [{ ...saved, value: "fresh-live" }]
    }
    setCookie = async () => { sets++; return true }
    deleteCookie = async () => { deletions++; return true }
    loadURL = async url => { this.url = url; if (nativeMode === "load") return new Promise(resolve => { this.finishLoad = resolve }); return true }
    waitForLoad = () => { throw new Error("Duplicate wait") }
    evaluateJavaScript = async script => {
      assert.equal(this.disposed, false)
      if (script === "return window.location.href") return this.url
      if (script.includes("targetSaved")) {
        if (nativeMode === "api") return new Promise(resolve => { this.finishAPI = resolve })
        return { ok: true, saved: false, authenticated: true }
      }
      return { url: this.url, html: `<html><body><video></video>${"MISSAV fixture ".repeat(70)}</body></html>` }
    }
    dispose() { assert.equal(this.disposed, false); this.disposed = true }
  }
  assert.deepEqual(await getMissAVWebsiteSavedState("/cn/fixture-001"), { saved: false, authenticated: true })
  assert.equal(sets, 0, "Fresh live account tokens must not be overwritten")
  assert.equal(deletions, 0, "Read-only account restoration must not clear shared cookies")
  for (const mode of ["load", "api", "cookie"]) {
    nativeMode = mode
    await assert.rejects(getMissAVWebsiteSavedState("/cn/fixture-001"), /读取网站收藏超时/)
    assert.equal(view.disposed, true)
    if (mode === "load") view.finishLoad(true)
    else if (mode === "api") view.finishAPI({ ok: true, saved: true, authenticated: true })
    else view.finishCookies([{ ...saved, value: "late-expired" }])
    await new Promise(resolve => timer(resolve, 5))
    assert.equal(JSON.parse(keychain.get("missav_account_cookie_v2_missav_ws"))[0].value, "fresh-live", "Late cookie capture must not overwrite the stored session")
  }
  console.log("PASS: deadline cleanup/late result; nonblocking hung cache; no destructive cookie restoration; website native load/API timeout cleanup")
} finally { globalThis.setTimeout = timer }
