import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule } from "./production-module.mjs"

const { HomeScreenLoader, continueWatchingRecords, playbackProgressFraction } = await import(compileProductionModule("../home-screen-data.ts"))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const video = code => ({ videoCode: code, title: code, detailPath: `/cn/${code}`, coverUrl: "" })
const record = (code, positionSeconds, durationSeconds) => ({ video: video(code), videoCode: code, positionSeconds, durationSeconds })
const page = (code, extra = {}) => ({ items: [video(code)], page: 1, title: code, hasNext: true, ...extra })
const records = [record("NEW", 0, 100), record("SHORT", 4, 100), record("DONE", 95, 100), record("BAD", NaN, 100), record("FIRST", 40, 100), record("UNKNOWN", 6), ...Array.from({ length: 8 }, (_, i) => record(`PLAY-${i}`, 10, 100))]
assert.deepEqual(continueWatchingRecords(records).map(item => item.videoCode), ["FIRST", "UNKNOWN", "PLAY-0", "PLAY-1", "PLAY-2"])
assert.equal(playbackProgressFraction(records[4]), 0.4)
assert.equal(playbackProgressFraction(records[5]), undefined)

let now = 1000
const history = [], requests = [], snapshots = [], scopes = []
const loader = new HomeScreenLoader({
  history() { const task = deferred(); history.push(task); return task.promise },
  cached: async params => page(`CACHE-${params.collection}`, { stale: true }),
  search(params, scope, force) { const task = deferred(); requests.push({ ...task, params, scope, force }); return task.promise },
  scope() { const value = { cancelled: false, cancel() { this.cancelled = true } }; scopes.push(value); return value },
  changed: data => snapshots.push(data), now: () => now,
})
const current = () => snapshots.at(-1)
const remote = loader.loadRemote()
assert.equal(loader.loadRemote(), remote, "Repeated selections share online work")
const local = loader.loadLocal()
history[0].resolve(records); await local; await flush()
assert.equal(current().recent[0].positionSeconds, 40, "Local progress publishes while network is pending")
assert.equal(current().latest[0].videoCode, "CACHE-new", "Cache publishes before live content")
assert.equal(requests.length, 2)
requests.find(item => item.params.collection === "new").resolve(page("LIVE-NEW")); await flush()
assert.equal(current().latest[0].videoCode, "LIVE-NEW", "A finished section never waits for the other section")
assert.equal(current().loading.latest, false)
assert.equal(current().loading.trending, true)
requests.find(item => item.params.collection === "today-hot").reject(new Error("Offline")); await remote
assert.equal(current().trending[0].videoCode, "CACHE-today-hot", "Failure retains cached content")
assert.equal(current().errors.trending, "Offline")
await loader.loadRemote(); assert.equal(requests.length, 2, "Retry cooldown prevents selection storms")
now += 10_001
const retry = loader.loadRemote(); await flush()
assert.equal(requests.length, 3, "Only the failed section retries inside the successful section TTL")
requests[2].resolve(page("LIVE-HOT")); await retry
await loader.loadRemote(); assert.equal(requests.length, 3)

const oldLocal = loader.loadLocal(), newLocal = loader.loadLocal()
history[2].resolve([record("RECENT", 20, 100)]); await newLocal
history[1].resolve([record("OBSOLETE", 30, 100)]); await oldLocal
assert.equal(current().recent[0].videoCode, "RECENT")
const refresh = loader.refresh(); await flush()
assert.equal(requests.length, 5)
assert.ok(requests.slice(3).every(item => item.force))
const replacement = loader.loadRemote(true); await flush()
assert.equal(scopes.at(-2).cancelled, true)
requests[3].resolve(page("OLD-NEW")); requests[4].resolve(page("OLD-HOT"))
history[3].resolve(records); await refresh
assert.equal(current().latest[0].videoCode, "LIVE-NEW", "Superseded refresh cannot overwrite content")
requests[5].resolve(page("REPLACED-NEW")); requests[6].resolve(page("REPLACED-HOT")); await replacement
assert.equal(current().latest[0].videoCode, "REPLACED-NEW")
const late = loader.loadRemote(true); await flush()
loader.dispose(); const snapshotCount = snapshots.length
requests[7].resolve(page("LATE-NEW")); requests[8].resolve(page("LATE-HOT")); await late
assert.equal(snapshots.length, snapshotCount, "Unmount/domain change blocks late writes")
assert.equal(scopes.at(-1).cancelled, true)
await loader.loadRemote(true); assert.equal(requests.length, 9)

const home = readFileSync(new URL("../home_screen_default_ui.tsx", import.meta.url), "utf8")
assert.match(home, /initialDetail=\{selected\.detail\}/)
assert.match(home, /preparation=\{selected\.preparation\}/)
assert.match(home, /detailNavigation\.open\(video\)/)
assert.doesNotMatch(home, /onDiscover=\{\(\) => \{\}\}|value\.map\(item => item\.video\)/)
assert.match(home, /placement="topBarTrailing"/)
assert.match(home, /ProgressView value=\{progress\} total=\{1\}/)
assert.match(home, /initialCollection=\{collection\}/)
assert.match(home, /\[accessReady, historyRevision, domainRevision\]/)
assert.match(home, /\[accessReady, domainRevision\]/)
console.log("PASS: HomeTab local-first, cache preview, progressive sections, TTL/retry/single-flight, force refresh, cancellation, progress filtering, prepared detail and native UI wiring")
