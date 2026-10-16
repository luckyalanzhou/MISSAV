import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

for (const file of ["storage.ts", "page/detail.tsx", "page/library.tsx", "page/home.tsx", "page/index.tsx", "page/recommendations.tsx", "page/search.tsx", "page/discover.tsx", "home_screen_default_ui.tsx", "page/settings.tsx"]) {
  assert.doesNotMatch(readFileSync(new URL("../" + file, import.meta.url), "utf8"), /favourites?|Favourite|本机收藏|加入收藏/, file)
}
assert.doesNotMatch(readFileSync(new URL("../database.ts", import.meta.url), "utf8"), /loadFavourite|toggleFavourite|MissAVFavouriteRecord/)
const preferences = new Map([["missav_melox_favourites_v1", [{ video: { videoCode: "old-only" } }]]])
globalThis.Storage = {
  get(key) { assert.doesNotMatch(key, /favourites/); return preferences.get(key) },
  set: (key, value) => preferences.set(key, value),
}
globalThis.FileManager = { documentsDirectory: "/fixture" }
const sqlite = new DatabaseSync(":memory:")
sqlite.exec(`CREATE TABLE videos (
  video_code TEXT PRIMARY KEY, title TEXT NOT NULL, detail_path TEXT NOT NULL, cover_url TEXT NOT NULL,
  duration TEXT, badge TEXT, actress TEXT, genres_json TEXT, maker TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE favourites (video_code TEXT PRIMARY KEY, added_at INTEGER);
INSERT INTO videos VALUES ('old-only','old-only sample','/cn/old-only','',NULL,NULL,NULL,NULL,NULL,1);
INSERT INTO favourites VALUES ('old-only',1);`)
const queries = []
const bridge = {
  execute: async (sql, args = []) => { queries.push(sql); return sqlite.prepare(sql).run(...args) },
  fetchOne: async (sql, args = []) => { queries.push(sql); return sqlite.prepare(sql).get(...args) || null },
  fetchAll: async (sql, args = []) => { queries.push(sql); return sqlite.prepare(sql).all(...args) },
  createIndex: async (name, options) => { const sql = `CREATE INDEX IF NOT EXISTS ${name} ON ${options.table} (${options.columns.join(",")})`; queries.push(sql); sqlite.exec(sql) },
  transaction: async steps => {
    sqlite.exec("BEGIN")
    try { for (const step of steps) await bridge.execute(step.sql, step.args); sqlite.exec("COMMIT") }
    catch (error) { sqlite.exec("ROLLBACK"); throw error }
  },
}
globalThis.SQLite = { open: () => bridge }
const db = await import(compile("../database.ts"))
const storage = await import(compile("../storage.ts"))
const video = code => ({ videoCode: code, title: code + " sample", detailPath: "/cn/" + code, coverUrl: "" })
try {
  await db.getMissAVDatabase()
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='favourites'").get(), undefined, "Upgrade removes the retired private favourites table")
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0, "Upgrade prunes video rows referenced only by removed favourites")
  assert.equal(Object.keys(db).some(key => /Favourite/.test(key)), false)
  assert.equal(Object.keys(storage).some(key => /Favourite/.test(key)), false)
  await db.recordBrowse(video("browse-001"))
  await db.recordPlayback(video("play-001"), { label: "1080p", url: "https://media.example/video.m3u8" })
  await db.savePlaybackProgress("play-001", 42, 120)
  const profile = await db.recommendationProfile()
  assert.deepEqual([...profile.excluded].sort(), ["browse-001", "play-001"])
  assert.equal(profile.terms.has("old-only"), false, "Former favourites do not affect recommendations")
  assert.equal((await storage.loadMissAVHistory())[0].positionSeconds, 42)
  assert.equal((await storage.loadMissAVBrowseHistory())[0].videoCode, "browse-001")
  await db.clearBrowseHistory()
  assert.equal((await storage.loadMissAVHistory())[0].positionSeconds, 42, "Clearing browse does not erase playback")
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos WHERE video_code='browse-001'").get().n, 0, "Clearing browse prunes unreferenced metadata")
  await db.clearPlaybackHistory()
  assert.equal((await storage.loadMissAVHistory()).length, 0)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0, "Clearing all history leaves no orphaned metadata")
  assert.match(queries.join("\n"), /DROP TABLE IF EXISTS favourites/i)
  console.log("PASS: no favourite UI/API/schema/legacy reads; one-time private-data cleanup; history-only recommendations; orphan pruning")
} finally { sqlite.close() }
