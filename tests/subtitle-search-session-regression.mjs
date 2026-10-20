import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
const { SubtitleSearchSession } = await import(compile("../subtitle-search-session.ts"))
const pending = []
const owner = new SubtitleSearchSession((code, options) => new Promise((resolve, reject) => pending.push({ code, options, resolve, reject })))
const result = { files: [], searchResultCount: 0, processedDetailCount: 0, failedDetailCount: 0 }
const observe = () => {
  const events = []
  return { events, onResult: value => events.push(value), onError: reason => events.push(reason), onSettled: () => events.push("settled") }
}
const controller = () => ({ dismissals: 0, dismiss() { this.dismissals++ } })

assert.equal(owner.stop(), false)
const first = observe()
const firstRun = owner.search("FIRST-001", false, first)
const firstWindow = controller()
pending[0].options.onControllerChange(firstWindow)
pending[0].options.onProgress(result)
assert.deepEqual(first.events, [result], "Publish partial progress immediately")

const second = observe()
const secondRun = owner.search("SECOND-002", true, second)
assert.equal(firstWindow.dismissals, 1, "Replacement dismisses the old validation window")
assert.equal(pending[0].options.isCancelled(), true)
assert.equal(pending[1].options.isCancelled(), false)
assert.equal(pending[1].code, "SECOND-002")
assert.equal(pending[1].options.forceRefresh, true)
const lateWindow = controller()
pending[0].options.onControllerChange(lateWindow)
assert.equal(lateWindow.dismissals, 1, "Even controllers delivered after cancellation are dismissed")
const secondWindow = controller()
pending[1].options.onControllerChange(secondWindow)
pending[0].options.onControllerChange(null)
pending[0].options.onProgress({ ...result, searchResultCount: 99 })
pending[0].reject(new Error("obsolete failure"))
await firstRun
assert.deepEqual(first.events, [result], "Old errors/progress/finally cannot update the replacement search")
assert.equal(owner.stop(), true)
assert.equal(secondWindow.dismissals, 1, "Old controller cleanup cannot lose the new controller")
pending[1].resolve(result)
await secondRun
assert.deepEqual(second.events, [], "Stopping suppresses late completion and settlement")
assert.equal(owner.stop(), false, "Stop is idempotent")
console.log("PASS: replacement/stop own controller dismissal and suppress stale progress, errors, results and settlement")

const failure = observe()
const failedRun = owner.search("RETRY-003", false, failure)
const error = new Error("offline")
pending[2].reject(error)
await failedRun
assert.deepEqual(failure.events, [error, "settled"])
const success = observe()
const retry = owner.search("RETRY-003", false, success)
pending[3].resolve(result)
await retry
assert.deepEqual(success.events, [result, "settled"])
assert.equal(pending[3].options.isCancelled(), true, "Completed searches no longer own callbacks")
pending[3].options.onProgress(result)
assert.deepEqual(success.events, [result, "settled"])
assert.equal(owner.stop(), false)
console.log("PASS: failures settle once, retry succeeds and completed callbacks are ignored")

const throwing = new SubtitleSearchSession(() => { throw error })
const synchronousFailure = observe()
await throwing.search("THROW-004", false, synchronousFailure)
assert.deepEqual(synchronousFailure.events, [error, "settled"])
const closing = controller()
closing.dismiss = () => { throw new Error("already closed") }
const closingRun = owner.search("CLOSE-005", false, observe())
pending[4].options.onControllerChange(closing)
assert.doesNotThrow(() => owner.stop())
assert.doesNotThrow(() => pending[4].options.onControllerChange(closing))
pending[4].resolve(result)
await closingRun
console.log("PASS: synchronous search failure and already-closing native windows clean up safely")
