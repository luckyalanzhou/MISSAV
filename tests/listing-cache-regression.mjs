import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"
const prefs = new Map()
globalThis.Storage = { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) }
globalThis.Keychain = { get: () => null, set: () => {} }
globalThis.FileManager = { documentsDirectory: "/fixture" }
const sqlite = new DatabaseSync(":memory:")
sqlite.exec("PRAGMA foreign_keys=ON")
let failSecondStep = false
const bridge = {
  execute: async (sql, args = []) => sqlite.prepare(sql).run(...args),
  fetchOne: async (sql, args = []) => sqlite.prepare(sql).get(...args) || null,
  fetchAll: async (sql, args = []) => sqlite.prepare(sql).all(...args),
  createIndex: async (name, options) => sqlite.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${options.table} (${options.columns.join(",")})`),
  transaction: async steps => {
    sqlite.exec("BEGIN")
    try {
      for (const [index, step] of steps.entries()) {
        if (failSecondStep && index === 1) throw new Error("Fixture failure")
        sqlite.prepare(step.sql).run(...(step.args || []))
      }
      sqlite.exec("COMMIT")
    } catch (error) { sqlite.exec("ROLLBACK"); throw error }
  },
}
globalThis.SQLite = { open: () => bridge }
const db = await import(compile("../database.ts"))
const cache = await import(compile("../listing-cache.ts"))
const { missavListingCacheDatabase: backend } = await import(compile("../listing-cache-db.ts"))
const { missavClient, MissAVRequestScope, isMissAVRequestCancelled } = await import(compile("../client.ts"))
const { setMissAVBaseURL } = await import(compile("../domain.ts"))
cache.installMissAVListingCache(backend)
const listing = code => `<html><head><title>MISSAV</title></head><body><h1>List</h1><a href="/cn/${code}"><img src="https://images.example/cover.jpg" alt="${code} title">1:02:03</a><a href="/cn/${code}">${code} title</a><footer>${"fixture ".repeat(80)}</footer></body></html>`
let html = listing("cache-001"), loads = 0
globalThis.WebViewController = class {
  getAllCookies = async () => []
  setCookie = async () => true
  loadURL = async url => { this.url = url; loads++; return true }
  waitForLoad = async () => true
  evaluateJavaScript = async () => ({ url: this.url, html })
  dispose() {}
}
const fresh = () => new missavClient.constructor()
try {
  await db.getMissAVDatabase()
  assert.equal(await db.getMissAVDatabase(), bridge)
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_favourites_added'").get())
  const key = cache.listingCacheKey("https://missav.ws/dm23/cn/release?sort=views&page=2&filters=multiple")
  assert.equal(key, cache.listingCacheKey("https://missav.ws/cn/release?filters=multiple&page=2&sort=views"))
  assert.notEqual(key, cache.listingCacheKey("https://missav.ai/cn/release?sort=views&page=2&filters=multiple"))
  for (const path of ["https://missav.ws/en/release", "https://missav.ws/ja/release", "https://evil.example/cn/new"]) assert.throws(() => cache.listingCacheKey(path))
  for (const query of ["page=3&sort=views&filters=multiple", "page=2&sort=saved&filters=multiple", "page=2&sort=views&filters=individual"]) assert.notEqual(key, cache.listingCacheKey(`https://missav.ws/cn/release?${query}`))
  const params = { collection: "new" }
  const result = await fresh().searchVideoPage(params)
  assert.equal(result.items[0].videoCode, "cache-001")
  const initialLoads = loads
  assert.equal((await fresh().searchVideoPage(params)).items[0].videoCode, "cache-001")
  assert.equal(loads, initialLoads, "A new client instance reuses a fresh persisted successful listing")
  await fresh().searchVideoPage(params, { forceRefresh: true })
  assert.equal(loads, initialLoads + 1)
  sqlite.prepare("UPDATE listing_cache SET saved_at=?").run(Date.now() - 120_000)
  html = '<html><title>Just a moment</title><body><div id="challenge-form">Verify you are human</div></body></html>'
  const shared = fresh()
  const stale = shared.searchVideoPage(params, { allowStale: true })
  const strict = assert.rejects(shared.searchVideoPage(params), /Cloudflare/)
  const fallback = await stale; await strict
  assert.equal(fallback.stale, true)
  assert.match(fallback.refreshError, /本地缓存.*Cloudflare/)
  assert.ok(shared.accessProbeRoutes().some(probe => probe.collection === "new"), "A cached fallback does not clear the need to verify this route")
  assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM listing_cache").get().payload).items[0].videoCode, "cache-001", "Challenges cannot overwrite persisted content")
  setMissAVBaseURL("https://missav.ai/")
  await assert.rejects(fresh().searchVideoPage(params, { allowStale: true }), /Cloudflare/)
  setMissAVBaseURL("https://missav.ws/")
  const path = "https://missav.ws/cn/new"
  const rowKey = cache.listingCacheKey(path)
  sqlite.prepare("UPDATE listing_cache SET payload='broken'").run()
  assert.equal(await cache.readCachedListing(path), null)
  await cache.writeCachedListing(path, result, Date.now())
  sqlite.prepare("UPDATE listing_cache SET saved_at=?").run(Date.now() - cache.LISTING_CACHE_MAX_AGE_MS - 1)
  assert.equal(await cache.readCachedListing(path), null)
  await cache.writeCachedListing(path, { ...result, items: [{ ...result.items[0], detailPath: "https://missav.ai/cn/other" }] }, Date.now())
  assert.equal(await cache.readCachedListing(path), null, "Malformed cross-domain payloads cannot replace valid data")
  await cache.writeCachedListing(path, result, Date.now())
  for (let page = 2; page <= 55; page++) await cache.writeCachedListing(`https://missav.ws/cn/new?page=${page}`, { ...result, page }, Date.now() + page)
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listing_cache").get().n, 48)
  // Native transaction failure must roll back the video as well as history.
  const video = { videoCode: "rollback-001", title: "Title", detailPath: "/cn/rollback-001", coverUrl: "" }
  failSecondStep = true
  await assert.rejects(db.recordBrowse(video), /Fixture failure/)
  assert.equal(sqlite.prepare("SELECT video_code FROM videos WHERE video_code=?").get(video.videoCode), undefined)
  failSecondStep = false
  await db.recordBrowse(video)
  assert.equal((await db.loadBrowseHistory())[0].viewCount, 1)
  // Cancel a disk read before a WebView is created; no late display/network.
  let resolveRead
  cache.installMissAVListingCache({ read: () => new Promise(resolve => { resolveRead = resolve }), write: async () => {} })
  const scope = new MissAVRequestScope(), before = loads
  const cancelled = fresh().searchVideoPage(params, { scope })
  const rejected = assert.rejects(cancelled, isMissAVRequestCancelled)
  for (let i = 0; i < 20 && !resolveRead; i++) await Promise.resolve()
  scope.cancel(); await rejected; resolveRead(null)
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(loads, before)
  for (const file of ["home", "discover", "search"]) assert.match(readFileSync(new URL(`../page/${file}.tsx`, import.meta.url), "utf8"), /allowStale: true/)
  assert.match(readFileSync(new URL("../page/search.tsx", import.meta.url), "utf8"), /\{error\}<\/Text>/)
  console.log("PASS: actual SQLite page persistence; full-key/domain/locale isolation; fresh reuse/forced refresh; marked per-owner stale fallback; no verification bypass; corrupt/expired caches; bounded page storage; transaction rollback; cancellation")
} finally { sqlite.close() }
