import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

globalThis.Storage = { get: () => undefined }
const diagnostics = await import(compile("../access-diagnostics.ts"))
const { runMissAVDataTask } = await import(compile("../background-data.ts"))
const { installMissAVLifecycle, subscribeMissAVLifecycle } = await import(compile("../lifecycle.ts"))
const oldThread = globalThis.Thread, oldWarn = console.warn
const warnings = []
console.warn = (...args) => warnings.push(args.join(" "))
try {
  delete globalThis.Thread
  assert.deepEqual(await runMissAVDataTask("subtitle-parse", () => ({ cues: ["PRIVATE_SUBTITLE"] })), { cues: ["PRIVATE_SUBTITLE"] })
  assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).background, false)
  let computeRuns = 0
  globalThis.Thread = { runInBackground: async compute => { computeRuns++; return compute() } }
  assert.equal(await runMissAVDataTask("subtitle-serialize", () => "PRIVATE_FILENAME"), "PRIVATE_FILENAME")
  assert.equal(computeRuns, 1)
  assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).background, true)
  await assert.rejects(runMissAVDataTask("subtitle-parse", () => { throw new Error("PRIVATE_EXCEPTION") }), /PRIVATE_EXCEPTION/)
  assert.equal(diagnostics.getMissAVAccessDiagnostics().at(-1).state, "load-error")
  // A dispatch failure cannot silently rerun the task and duplicate side effects.
  globalThis.Thread = { runInBackground: async () => { throw new Error("Dispatch failed") } }
  await assert.rejects(runMissAVDataTask("subtitle-parse", () => { computeRuns++; return 0 }), /Dispatch failed/)
  assert.equal(computeRuns, 2)

  let minimize, resume, removed = 0
  const host = {
    onMinimize: callback => { minimize = callback; return () => { removed++ } },
    onResume: callback => { resume = callback; return () => { removed++ } },
  }
  const seen = []
  const stopBroken = subscribeMissAVLifecycle(() => { throw new Error("PRIVATE_LISTENER") })
  const stopEvents = subscribeMissAVLifecycle(event => seen.push(event))
  const dispose = installMissAVLifecycle(host)
  resume({ resumeFromMinimized: false, queryParameters: { token: "PRIVATE_TOKEN" } })
  minimize(); minimize()
  resume({ resumeFromMinimized: false })
  resume({ resumeFromMinimized: true, queryParameters: { token: "PRIVATE_TOKEN" } })
  resume({ resumeFromMinimized: true })
  assert.deepEqual(seen.map(event => event.kind), ["minimize", "resume"])
  assert.ok(seen.every(event => event.minimizedForMs >= 0))
  dispose(); dispose(); minimize(); resume({ resumeFromMinimized: true })
  assert.equal(removed, 2)
  assert.equal(seen.length, 2)
  stopBroken(); stopEvents()
  diagnostics.recordMissAVAccessDiagnostic("page", "https://missav.ws/cn/new?token=PRIVATE_TOKEN", {
    state: "normal", cookieMs: 12.5, loadMs: -2, captureMs: Infinity, parseMs: 4, parseCount: 2,
    phase: "PRIVATE_PHASE", background: "PRIVATE_BACKGROUND", secret: "PRIVATE_SECRET",
  })
  const last = diagnostics.getMissAVAccessDiagnostics().at(-1)
  assert.equal(last.cookieMs, 13); assert.equal(last.loadMs, 0)
  assert.equal(last.captureMs, undefined); assert.equal(last.phase, undefined); assert.equal(last.background, undefined)
  assert.doesNotMatch(JSON.stringify(diagnostics.getMissAVAccessDiagnostics()) + warnings.join("\n"), /PRIVATE_/)
  const entry = readFileSync(new URL("../index.tsx", import.meta.url), "utf8")
  assert.match(entry, /installMissAVLifecycle\(Script\)/)
  assert.doesNotMatch(entry, /onResume\(\(\) => \{\}\)/)
  const lifecycle = readFileSync(new URL("../lifecycle.ts", import.meta.url), "utf8")
  assert.doesNotMatch(lifecycle, /WebViewController|openMissAVSiteVerification|Navigation\.present|searchVideoPage/)
  console.log("PASS: background computation/fallback/errors; coalesced minimize/resume; listener cleanup/isolation; no automatic network or verification; redacted phase timings")
} finally {
  console.warn = oldWarn
  if (oldThread === undefined) delete globalThis.Thread
  else globalThis.Thread = oldThread
}
