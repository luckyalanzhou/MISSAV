// Node 24+; pass Playwright's bundled Babel path as argv[2] for TSX checks.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { compileProductionModule as compile } from "./production-module.mjs"

const require = createRequire(import.meta.url)
const { babelTransform } = require(process.argv[2] || "playwright/lib/transform/babelBundle.js")
const requestTypes = await import(compile("../request-scope.ts"))
const preferences = new Map()
globalThis.Storage = { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) }
globalThis.FileManager = { documentsDirectory: "/fixture" }
const sqlite = new DatabaseSync(":memory:")
sqlite.exec("PRAGMA foreign_keys = ON")
const nativeBridge = {
  transaction: async steps => {
    sqlite.exec("BEGIN")
    try { for (const step of steps) sqlite.prepare(step.sql).run(...(step.args || [])); sqlite.exec("COMMIT") }
    catch (error) { sqlite.exec("ROLLBACK"); throw error }
  },
  execute: async (sql, params = []) => sqlite.prepare(sql).run(...params),
  fetchAll: async (sql, params = []) => sqlite.prepare(sql).all(...params),
  fetchOne: async (sql, params = []) => sqlite.prepare(sql).get(...params) || null,
  createIndex: async (name, options) => sqlite.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${options.table} (${options.columns.join(",")})`),
}
globalThis.SQLite = { open: () => nativeBridge }
const database = await import(compile("../database.ts"))
const storage = await import(compile("../storage.ts"))
const progress = await import(compile("../playback-progress.ts"))
const video = code => ({ videoCode: code, title: `${code} title`, detailPath: `/cn/${code}`, coverUrl: "", duration: "2:10:00" })
const source = label => ({ label, url: "https://cdn.example/video.m3u8", type: "application/vnd.apple.mpegurl" })
const first = video("first-001")
const legacy = video("legacy-002")
const dateNow = Date.now
let clock = 1000
Date.now = () => clock

const jsx = (type, props, key) => ({ type, props: props || {}, key })
const named = (nodes, name) => nodes.find(node => (typeof node.type === "function" ? node.type.name : node.type) === name)
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function pageHarness(relative, exported) {
  const states = []
  const effects = new Map()
  let hook = 0
  let queued = []
  const state = initial => {
    const index = hook++
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
    return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value }]
  }
  const scripting = {
    ...Object.fromEntries(["Button", "Divider", "HStack", "Image", "LazyHStack", "Menu", "Picker", "ScrollView", "Text", "VStack", "ZStack"].map(name => [name, name])),
    useState: state,
    useRef: initial => state(() => ({ current: initial }))[0],
    useObservable: initial => state(() => ({ value: initial, setValue(value) { this.value = value } }))[0],
    useEffect: (effect, dependencies) => {
      const index = hook++
      const previous = effects.get(index)
      if (previous && previous.length === dependencies.length && previous.every((item, i) => Object.is(item, dependencies[i]))) return
      effects.set(index, dependencies)
      queued.push(effect)
    },
  }
  const path = fileURLToPath(new URL(relative, import.meta.url))
  const compiled = babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting").code
  const module = { exports: {} }
  new Function("require", "module", "exports", compiled)(specifier => {
    if (specifier === "scripting") return scripting
    if (specifier === "scripting/jsx-runtime") return { jsx, jsxs: jsx }
    if (specifier === "../storage") return storage
    if (specifier === "../playback-progress") return progress
    if (specifier === "../client") return { ...requestTypes, missavClient: { searchVideoPage: async () => ({ items: [] }) } }
    if (specifier === "../account") return { loadMissAVSavedVideos: async () => ({ items: [], page: 1, hasNext: false }) }
    if (specifier === "../design") return { PageBackground: "PageBackground", SectionHeading: "SectionHeading", ActionRow: "ActionRow" }
    if (specifier === "./components/media_cards") return { MediaHero: "MediaHero", MediaTile: "MediaTile" }
    if (specifier === "./components/video_row") return { VideoRowList: "VideoRowList" }
    if (specifier === "./components/destructive_menu") return { DestructiveMenu: "DestructiveMenu" }
    if (specifier === "./components/state_view") return { StateView: "StateView" }
    if (specifier === "./recommendations") return { RecommendationsPage: "RecommendationsPage" }
    if (specifier === "./detail") return { DetailPage: "DetailPage" }
    throw new Error(`Unexpected module: ${specifier}`)
  }, module, module.exports)
  return props => {
    hook = 0
    queued = []
    const nodes = []
    function visit(value) {
      if (Array.isArray(value)) { value.forEach(visit); return }
      if (!value?.props) return
      nodes.push(value)
      visit(value.props.children)
    }
    visit(module.exports[exported](props))
    queued.forEach(effect => effect())
    return nodes
  }
}

try {
  await database.recordPlayback(first, source("1080p"))
  clock += 1000
  await database.recordPlayback(legacy, source("720p"))
  await database.savePlaybackProgress(first.videoCode, 754.9, 7800)
  let records = await storage.loadMissAVHistory()
  assert.deepEqual(records.map(record => record.videoCode), [legacy.videoCode, first.videoCode])
  assert.equal(records[0].positionSeconds, undefined, "The left join must keep old records without progress")
  assert.equal(records[1].positionSeconds, 754.9, "Match the saved position by video code")
  assert.equal(records[1].durationSeconds, 7800)
  assert.equal(records[1].qualityLabel, "1080p", "Keep original quality metadata without using it as the progress label")
  clock += 1000
  await database.recordPlayback(first, source("720p"))
  assert.equal((await storage.loadMissAVHistory(1))[0].positionSeconds, 754.9, "Reopening a video must not erase its resume point")

  const callbacks = { onFavouriteChanged() {}, onHistoryChanged() {}, onDiscover() {}, onLibrary() {} }
  const library = pageHarness("../page/library.tsx", "LibraryPage")
  let nodes = library({ ...callbacks, favouritesRevision: 0, historyRevision: 0, accountRevision: 0 })
  await settle()
  named(nodes, "Picker").props.onChanged("history")
  nodes = library({ ...callbacks, favouritesRevision: 0, historyRevision: 0, accountRevision: 0 })
  const rowList = named(nodes, "VideoRowList")
  assert.equal(rowList.props.status(first), "继续观看 · 12:34")
  assert.equal(rowList.props.status(legacy), "继续观看 · 00:00")
  assert.equal(rowList.props.statusSystemImage, "play.circle")
  rowList.props.onOpen(first)
  assert.equal(named(library({ ...callbacks, favouritesRevision: 0, historyRevision: 0, accountRevision: 0 }), "ScrollView").props.navigationDestination.content.props.video.videoCode, first.videoCode)

  const home = pageHarness("../page/home.tsx", "MediaHomePage")
  home({ ...callbacks, revision: 0 })
  await settle()
  let hero = named(home({ ...callbacks, revision: 0 }), "MediaHero")
  assert.equal(hero.props.eyebrow, "继续观看 · 12:34")
  assert.equal(hero.props.video.videoCode, first.videoCode)

  await database.savePlaybackProgress(first.videoCode, 3723.9, 7800)
  library({ ...callbacks, favouritesRevision: 0, historyRevision: 1, accountRevision: 0 })
  home({ ...callbacks, revision: 1 })
  await settle()
  assert.equal(named(library({ ...callbacks, favouritesRevision: 0, historyRevision: 1, accountRevision: 0 }), "VideoRowList").props.status(first), "继续观看 · 1:02:03", "Closing playback and refreshing its revision must expose the latest saved progress")
  hero = named(home({ ...callbacks, revision: 1 }), "MediaHero")
  assert.equal(hero.props.eyebrow, "继续观看 · 1:02:03")

  await database.savePlaybackProgress(first.videoCode, 0, 7800)
  assert.equal((await storage.loadMissAVHistory(1))[0].positionSeconds, undefined, "Ended playback clears progress without losing history")
  await database.savePlaybackProgress(first.videoCode, 65, NaN)
  records = await storage.loadMissAVHistory()
  assert.equal(records[0].positionSeconds, 65)
  assert.equal(records[0].durationSeconds, undefined)
  assert.equal(progress.formatMissAVContinueWatching(records[0].positionSeconds), "继续观看 · 01:05")
  await database.clearPlaybackHistory()
  assert.deepEqual(await storage.loadMissAVHistory(), [])
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM playback_progress").get().count, 0)
  console.log("PASS: actual SQLite history/progress join, legacy records, limits, reset, library/home labels and refresh")
} finally {
  Date.now = dateNow
  sqlite.close()
}
