import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
globalThis.Storage = { get() {}, set() {} }
const { MissAVListingRequest } = await import(compile("../listing-request.ts"))
const pending = [], results = [], errors = [], settled = []
const request = new MissAVListingRequest((params, options) => new Promise((resolve, reject) => pending.push({ params, scope: options.scope, resolve, reject })))
const observer = id => ({ loaded: page => results.push([id, page]), failed: error => errors.push([id, error.message]), settled: () => settled.push(id) })
const old = request.load({ query: "old" }, {}, observer("old"))
const fresh = request.load({ query: "fresh" }, {}, observer("fresh"))
assert.equal(pending[0].scope.cancelled, true)
pending[0].resolve({ items: ["wrong"] })
pending[1].resolve({ items: ["right"], refreshError: "cached" })
await Promise.all([old, fresh])
assert.deepEqual(results, [["fresh", { items: ["right"], refreshError: "cached" }]])
assert.deepEqual(settled, ["fresh"])
const cancelled = request.load({ page: 2 }, {}, observer("cancelled"))
request.cancel(); await cancelled
pending[2].reject(new Error("late")); await Promise.resolve()
assert.deepEqual(errors, [])
const failed = request.load({ page: 2 }, {}, observer("retry"))
pending[3].reject(new Error("offline")); await failed
assert.deepEqual(errors, [["retry", "offline"]])
assert.deepEqual(settled, ["fresh", "retry"])
console.log("PASS: listing supersession, late response suppression, cancellation, cache metadata and recoverable failure")
