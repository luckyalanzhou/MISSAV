import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
const { MissAVAccessSession } = await import(compile("../access-session.ts"))
const { MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../request-scope.ts"))
const session = new MissAVAccessSession()
const active = new MissAVRequestScope()
session.track(active)
let notifications = 0
session.subscribe(() => notifications++)
const finish = session.beginVerification()
assert.equal(active.cancelled, true)
assert.equal(session.verifying, true)
assert.throws(() => session.beginVerification(), /正在进行/)
let opened = false
const caller = new MissAVRequestScope()
const waiting = session.wait(caller).then(() => { opened = true })
await Promise.resolve(); assert.equal(opened, false)
const cancelled = new MissAVRequestScope()
const rejected = assert.rejects(session.wait(cancelled), isMissAVRequestCancelled)
cancelled.cancel(); await rejected
finish(); finish(); await waiting
assert.equal(opened, true)
assert.equal(session.verifying, false)
assert.equal(notifications, 2)
assert.equal(session.revision, 1)
session.invalidate(); assert.equal(session.revision, 2)
console.log("PASS: access context invalidation, native cancellation, verification single owner, waiting consumers and idempotent release")
