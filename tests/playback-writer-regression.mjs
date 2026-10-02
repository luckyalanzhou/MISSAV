import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
const { createPlaybackProgressWriter } = await import(compile("../playback-writer.ts"))
let release
const writes = []
const errors = []
const writer = createPlaybackProgressWriter(async (position, duration) => {
  writes.push([position, duration])
  if (writes.length === 1) await new Promise(resolve => { release = resolve })
}, error => errors.push(error))
writer.enqueue(10, 100)
await Promise.resolve(); await Promise.resolve()
for (let position = 11; position <= 100; position++) writer.enqueue(position, 100)
writer.enqueue(NaN, 100); writer.enqueue(-1, 100)
assert.equal(writes.length, 1)
release(); await writer.flush()
assert.deepEqual(writes, [[10, 100], [100, 100]])
writer.enqueue(100, 100); await writer.flush()
assert.equal(writes.length, 2)
writer.enqueue(0, 100); await writer.flush()
assert.deepEqual(writes.at(-1), [0, 100], "Ended progress clears the resume point")
let attempts = 0
const retry = createPlaybackProgressWriter(() => { if (++attempts === 1) throw new Error("Transient write") }, error => errors.push(error))
retry.enqueue(20, 100); await retry.flush()
retry.enqueue(20, 100); await retry.flush()
assert.equal(attempts, 2); assert.equal(errors.length, 1)
console.log("PASS: bounded coalescing writes; duplicate/invalid snapshot guards; final end/reset; failed-write retry and flush")
