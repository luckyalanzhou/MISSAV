import assert from "node:assert/strict"
import { compileProductionModule as compile } from "./production-module.mjs"

const preferences = new Map()
globalThis.Storage = { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) }
globalThis.Keychain = { get: () => null, set() {} }
const clock = Date.now, info = console.info
let now = clock(), loads = 0
Date.now = () => now
console.info = () => {}
globalThis.WebViewController = class {
  async getAllCookies() { return [] }
  async loadURL(url) { this.url = url; this.version = ++loads; return true }
  async evaluateJavaScript() { return { url: this.url, html: `<html><title>MISSAV</title><body>${"content ".repeat(80)}<video src="https://cdn.example/1080p/video.m3u8?token=${this.version}"></video></body></html>` } }
  dispose() {}
}
try {
  const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
  const detail = await missavClient.getVideo("abc-001")
  const recent = await missavClient.getVideo("abc-001", { preferRecent: true })
  assert.equal(loads, 1, "Immediate playback does not repeat the detail WebView request")
  assert.equal(recent.sources[0].url, detail.sources[0].url)
  recent.sources[0].url = "MUTATED"; recent.genres.push("MUTATED")
  assert.deepEqual(await missavClient.getVideo("abc-001", { preferRecent: true }), detail, "Consumer mutations do not reach the cache")
  assert.match((await missavClient.getVideo("abc-001")).sources[0].url, /token=2$/, "Detail refresh always fetches live content")
  now += 10_001
  assert.match((await missavClient.getVideo("abc-001", { preferRecent: true })).sources[0].url, /token=3$/, "Expired URLs are refreshed")
  const finishVerification = missavClient.beginSiteVerification()
  const pending = missavClient.getVideo("abc-001", { preferRecent: true })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(loads, 3, "Cache cannot bypass an active verification gate")
  finishVerification()
  assert.match((await pending).sources[0].url, /token=4$/, "Verification invalidates prior details")
  const cancelled = new MissAVRequestScope(); cancelled.cancel()
  await assert.rejects(missavClient.getVideo("abc-001", { preferRecent: true, scope: cancelled }), isMissAVRequestCancelled)
  preferences.set("missav_preferred_domain_v1", "https://missav.ai/")
  const switched = await missavClient.getVideo("abc-001", { preferRecent: true })
  assert.match(switched.watchUrl, /^https:\/\/missav.ai\//)
  assert.match(switched.sources[0].url, /^https:\/\/cdn.example\/.+token=5$/, "Media CDN URL is never rewritten to selected domain")
  preferences.set("missav_preferred_domain_v1", "https://missav.ws/")
  assert.match((await missavClient.getVideo("abc-001", { preferRecent: true })).sources[0].url, /token=6$/, "Switching back does not revive an old domain cache")
  missavClient.clearSearchPageCache()
  assert.match((await missavClient.getVideo("abc-001", { preferRecent: true })).sources[0].url, /token=7$/)
  await missavClient.getVideo("abc-002", { preferRecent: true })
  assert.equal(loads, 8, "Other videos cannot reuse the previous video's source")
  console.log("PASS: 10-second playback-only detail reuse; forced live refresh; verification/domain invalidation; cancellation, cloning and signed CDN URL preservation")
} finally { Date.now = clock; console.info = info }
