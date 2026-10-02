import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

globalThis.Storage = { get: () => undefined, set: () => {} }
const { withMissAVDeadline } = await import(compile("../request-deadline.ts"))
const { installMissAVListingCache, readCachedListing, writeCachedListing } = await import(compile("../listing-cache.ts"))

let cleanups = 0, finish
await assert.rejects(withMissAVDeadline(new Promise(resolve => { finish = resolve }), 10, "Fixture timeout", () => { cleanups++ }), /Fixture timeout/)
finish("late")
assert.equal(cleanups, 1)
assert.equal(await withMissAVDeadline(Promise.resolve("ok"), 10, "timeout", () => { cleanups++ }), "ok")
assert.equal(cleanups, 1)

installMissAVListingCache({ read: () => new Promise(() => {}), write: () => new Promise(() => {}) })
assert.equal(await readCachedListing("https://missav.ws/cn/new"), null, "Hung SQLite cache must not block online loading")
await writeCachedListing("https://missav.ws/cn/new", { title: "Listing", page: 1, hasNext: false, items: [{ videoCode: "fixture-001", title: "Fixture", detailPath: "/cn/fixture-001", coverUrl: "" }] }, Date.now())

console.log("PASS: deadline cleanup/late result and nonblocking hung listing cache")
