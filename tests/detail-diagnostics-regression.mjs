import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"
globalThis.Storage = { get: () => undefined }
const diagnostics = await import(compile("../access-diagnostics.ts"))
const { createMissAVDetailTrace } = await import(compile("../detail-loading.ts"))
const info = console.info, warn = console.warn, messages = []
console.info = console.warn = (...args) => messages.push(args.join(" "))
try {
  const progress = []
  const trace = createMissAVDetailTrace("https://missav.ws/cn/private-code?token=PRIVATE_TOKEN", value => progress.push(value))
  trace.mark("entered"); trace.mark("page-load"); trace.mark("page-load")
  trace.mark("source-parse", { documentChars: 200_000, sourceCount: 3, cookie: "PRIVATE_COOKIE" })
  trace.mark("timeout")
  assert.equal(progress.length, 4)
  assert.match(trace.describe(), /加载详情网页/)
  assert.match(trace.describe(), /获取播放信息超时/)
  assert.ok(progress.every(value => value.requestId === progress[0].requestId && value.elapsedMs >= 0))
  const entries = diagnostics.getMissAVAccessDiagnostics()
  assert.deepEqual(entries.map(value => value.detailStage), ["entered", "page-load", "source-parse", "timeout"])
  assert.ok(entries.every(value => value.route === "cn/:detail"))
  assert.equal(entries[2].documentChars, 200_000)
  assert.doesNotMatch(messages.join("\n") + trace.describe() + JSON.stringify(entries), /PRIVATE_|private-code/)
  const brokenObserver = createMissAVDetailTrace("https://missav.ws/cn/fixture-001", () => { throw Error("PRIVATE_ERROR") })
  for (let i = 0; i < 40; i++) brokenObserver.mark(i % 2 ? "document-read" : "source-parse")
  assert.equal(brokenObserver.describe().split("\n").length, 25)
  assert.ok(diagnostics.getMissAVAccessDiagnostics().length <= 60)
  console.log("PASS: per-request stages, timeout and timings, deduplication, bounded traces, observer isolation and redaction")
} finally { console.info = info; console.warn = warn }
