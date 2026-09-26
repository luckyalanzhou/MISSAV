import { Path } from "scripting"
import type { MissAVVideoDetail, MissAVVideoItem, MissAVVideoSource } from "./client"

export type MissAVFavouriteRecord = { sourceId: "builtin.missav"; videoCode: string; video: MissAVVideoItem; addedAt: number }
export type MissAVPlaybackRecord = { sourceId: "builtin.missav"; videoCode: string; video: MissAVVideoItem; lastPlayedAt: number; qualityLabel: string; player?: string }
export type MissAVPlaybackProgress = { videoCode: string; positionSeconds: number; durationSeconds?: number; updatedAt: number }
export type MissAVBrowseRecord = { videoCode: string; video: MissAVVideoItem; lastViewedAt: number; viewCount: number }

type VideoRow = { video_code: string; title: string; detail_path: string; cover_url: string; duration: string | null; badge: string | null }
type FavouriteRow = VideoRow & { added_at: number }
type PlaybackRow = VideoRow & { last_played_at: number; quality_label: string }
type PlaybackProgressRow = { video_code: string; position_seconds: number; duration_seconds: number | null; updated_at: number }
type BrowseRow = VideoRow & { last_viewed_at: number; view_count: number }

const DB_PATH = Path.join(FileManager.documentsDirectory, "missav-library.db")
const MIGRATION_KEY = "missav_sqlite_migration_v1"
const LEGACY_NAMESPACE = ["me", "lox"].join("")
const OLD_FAVOURITES_KEY = `missav_${LEGACY_NAMESPACE}_favourites_v1`
const OLD_HISTORY_KEY = `missav_${LEGACY_NAMESPACE}_playback_history_v1`
let databasePromise: Promise<SQLite.Database> | null = null

export function getMissAVDatabase(): Promise<SQLite.Database> {
  if (!databasePromise) {
    const opening = (async () => {
      const db = SQLite.open(DB_PATH, { foreignKeysEnabled: true, readonly: false, label: "MISSAV Library", busyMode: 3, journalMode: "wal", maximumReaderCount: 3 })
      await db.execute(`CREATE TABLE IF NOT EXISTS videos (
        video_code TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail_path TEXT NOT NULL,
        cover_url TEXT NOT NULL,
        duration TEXT,
        badge TEXT,
        actress TEXT,
        genres_json TEXT,
        maker TEXT,
        updated_at INTEGER NOT NULL
      )`)
      await db.execute(`CREATE TABLE IF NOT EXISTS favourites (video_code TEXT PRIMARY KEY REFERENCES videos(video_code) ON DELETE CASCADE, added_at INTEGER NOT NULL)`)
      await db.execute(`CREATE TABLE IF NOT EXISTS browse_history (video_code TEXT PRIMARY KEY REFERENCES videos(video_code) ON DELETE CASCADE, first_viewed_at INTEGER NOT NULL, last_viewed_at INTEGER NOT NULL, view_count INTEGER NOT NULL DEFAULT 1)`)
      await db.execute(`CREATE TABLE IF NOT EXISTS playback_history (video_code TEXT PRIMARY KEY REFERENCES videos(video_code) ON DELETE CASCADE, first_played_at INTEGER NOT NULL, last_played_at INTEGER NOT NULL, play_count INTEGER NOT NULL DEFAULT 1, quality_label TEXT NOT NULL)`)
      await db.execute(`CREATE TABLE IF NOT EXISTS playback_progress (video_code TEXT PRIMARY KEY REFERENCES videos(video_code) ON DELETE CASCADE, position_seconds REAL NOT NULL, duration_seconds REAL, updated_at INTEGER NOT NULL)`)
      await db.createIndex("idx_browse_last_viewed", { table: "browse_history", columns: ["last_viewed_at"], ifNotExists: true })
      await db.createIndex("idx_playback_last_played", { table: "playback_history", columns: ["last_played_at"], ifNotExists: true })
      await migrateLegacyRecords(db)
      return db
    })()
    databasePromise = opening.catch(error => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise!
}

async function upsertVideo(db: SQLite.Database, video: MissAVVideoItem, detail?: MissAVVideoDetail): Promise<void> {
  await db.execute(`INSERT INTO videos (video_code, title, detail_path, cover_url, duration, badge, actress, genres_json, maker, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_code) DO UPDATE SET title=excluded.title, detail_path=excluded.detail_path, cover_url=excluded.cover_url, duration=excluded.duration, badge=excluded.badge,
      actress=COALESCE(excluded.actress, videos.actress), genres_json=COALESCE(excluded.genres_json, videos.genres_json), maker=COALESCE(excluded.maker, videos.maker), updated_at=excluded.updated_at`,
    [video.videoCode, detail?.title || video.title, video.detailPath, detail?.coverUrl || video.coverUrl, detail?.duration || video.duration || null, video.badge || null, detail?.actress || null, detail ? JSON.stringify(detail.genres) : null, detail?.maker || null, Date.now()])
}

export async function saveVideoDetail(video: MissAVVideoItem, detail: MissAVVideoDetail): Promise<void> { const db = await getMissAVDatabase(); await upsertVideo(db, video, detail) }

export async function loadFavourites(limit?: number): Promise<MissAVFavouriteRecord[]> {
  const db = await getMissAVDatabase()
  const boundedLimit = limit == null ? null : Math.max(1, Math.floor(limit))
  const sql = `SELECT v.video_code, v.title, v.detail_path, v.cover_url, v.duration, v.badge, f.added_at FROM favourites f JOIN videos v USING(video_code) ORDER BY f.added_at DESC${boundedLimit == null ? "" : " LIMIT ?"}`
  return (await db.fetchAll<FavouriteRow>(sql, boundedLimit == null ? [] : [boundedLimit])).map(row => ({ sourceId: "builtin.missav", videoCode: row.video_code, video: rowToVideo(row), addedAt: row.added_at }))
}
export async function isFavourite(videoCode: string): Promise<boolean> { const db = await getMissAVDatabase(); return Boolean(await db.fetchOne<{ video_code: string }>("SELECT video_code FROM favourites WHERE video_code = ?", [videoCode])) }
export async function toggleFavourite(video: MissAVVideoItem): Promise<boolean> {
  const db = await getMissAVDatabase(); await upsertVideo(db, video)
  const existing = await db.fetchOne<{ video_code: string }>("SELECT video_code FROM favourites WHERE video_code = ?", [video.videoCode])
  if (existing) { await db.execute("DELETE FROM favourites WHERE video_code = ?", [video.videoCode]); return false }
  await db.execute("INSERT INTO favourites (video_code, added_at) VALUES (?, ?)", [video.videoCode, Date.now()]); return true
}

export async function recordBrowse(video: MissAVVideoItem, detail?: MissAVVideoDetail): Promise<void> {
  const db = await getMissAVDatabase(); await upsertVideo(db, video, detail); await updateBrowseRecord(db, video.videoCode)
}
export async function saveVideoDetailAndRecordBrowse(video: MissAVVideoItem, detail: MissAVVideoDetail): Promise<void> {
  const db = await getMissAVDatabase(); await upsertVideo(db, video, detail); await updateBrowseRecord(db, video.videoCode)
}
async function updateBrowseRecord(db: SQLite.Database, videoCode: string): Promise<void> {
  const now = Date.now()
  await db.execute(`INSERT INTO browse_history (video_code, first_viewed_at, last_viewed_at, view_count) VALUES (?, ?, ?, 1)
    ON CONFLICT(video_code) DO UPDATE SET last_viewed_at=excluded.last_viewed_at, view_count=browse_history.view_count+1`, [videoCode, now, now])
}
export async function loadBrowseHistory(limit = 100): Promise<MissAVBrowseRecord[]> {
  const db = await getMissAVDatabase()
  return (await db.fetchAll<BrowseRow>(`SELECT v.video_code, v.title, v.detail_path, v.cover_url, v.duration, v.badge, h.last_viewed_at, h.view_count FROM browse_history h JOIN videos v USING(video_code) ORDER BY h.last_viewed_at DESC LIMIT ?`, [limit])).map(row => ({ videoCode: row.video_code, video: rowToVideo(row), lastViewedAt: row.last_viewed_at, viewCount: row.view_count }))
}

export async function recordPlayback(video: MissAVVideoItem, source: MissAVVideoSource): Promise<void> {
  const db = await getMissAVDatabase(); await upsertVideo(db, video); const now = Date.now()
  await db.execute(`INSERT INTO playback_history (video_code, first_played_at, last_played_at, play_count, quality_label) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(video_code) DO UPDATE SET last_played_at=excluded.last_played_at, play_count=playback_history.play_count+1, quality_label=excluded.quality_label`, [video.videoCode, now, now, source.label])
}
export async function loadPlaybackHistory(limit = 100): Promise<MissAVPlaybackRecord[]> {
  const db = await getMissAVDatabase()
  return (await db.fetchAll<PlaybackRow>(`SELECT v.video_code, v.title, v.detail_path, v.cover_url, v.duration, v.badge, h.last_played_at, h.quality_label FROM playback_history h JOIN videos v USING(video_code) ORDER BY h.last_played_at DESC LIMIT ?`, [limit])).map(row => ({ sourceId: "builtin.missav", videoCode: row.video_code, video: rowToVideo(row), lastPlayedAt: row.last_played_at, qualityLabel: row.quality_label }))
}
export async function loadPlaybackProgress(videoCode: string): Promise<MissAVPlaybackProgress | null> {
  const db = await getMissAVDatabase()
  const row = await db.fetchOne<PlaybackProgressRow>("SELECT video_code, position_seconds, duration_seconds, updated_at FROM playback_progress WHERE video_code = ?", [videoCode])
  return row ? { videoCode: row.video_code, positionSeconds: row.position_seconds, durationSeconds: row.duration_seconds ?? undefined, updatedAt: row.updated_at } : null
}
export async function savePlaybackProgress(videoCode: string, positionSeconds: number, durationSeconds: number): Promise<void> {
  const db = await getMissAVDatabase()
  const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0
  if (position < 5) {
    await db.execute("DELETE FROM playback_progress WHERE video_code = ?", [videoCode])
    return
  }
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null
  await db.execute(`INSERT INTO playback_progress (video_code, position_seconds, duration_seconds, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(video_code) DO UPDATE SET position_seconds=excluded.position_seconds, duration_seconds=excluded.duration_seconds, updated_at=excluded.updated_at`,
    [videoCode, position, duration, Date.now()])
}
export async function clearPlaybackHistory(): Promise<void> {
  const db = await getMissAVDatabase()
  await db.execute("DELETE FROM playback_progress")
  await db.execute("DELETE FROM playback_history")
}
export async function clearBrowseHistory(): Promise<void> { const db = await getMissAVDatabase(); await db.execute("DELETE FROM browse_history") }

export async function recommendationProfile(): Promise<{ terms: Map<string, number>; excluded: Set<string> }> {
  const db = await getMissAVDatabase()
  const rows = await db.fetchAll<{ video_code: string; title: string; actress: string | null; genres_json: string | null; maker: string | null; favourite: number; plays: number; views: number }>(`SELECT v.video_code, v.title, v.actress, v.genres_json, v.maker,
    CASE WHEN f.video_code IS NULL THEN 0 ELSE 1 END favourite, COALESCE(p.play_count,0) plays, COALESCE(b.view_count,0) views
    FROM videos v LEFT JOIN favourites f USING(video_code) LEFT JOIN playback_history p USING(video_code) LEFT JOIN browse_history b USING(video_code)
    WHERE f.video_code IS NOT NULL OR p.video_code IS NOT NULL OR b.video_code IS NOT NULL`)
  const terms = new Map<string, number>(); const excluded = new Set<string>()
  for (const row of rows) {
    excluded.add(row.video_code)
    const weight = row.favourite * 7 + Math.min(row.plays, 5) * 3 + Math.min(row.views, 8)
    const values = [row.title, row.actress || "", row.maker || "", ...safeGenres(row.genres_json), codePrefix(row.video_code)]
    for (const term of tokenize(values.join(" "))) terms.set(term, (terms.get(term) || 0) + weight)
  }
  return { terms, excluded }
}

function rowToVideo(row: VideoRow): MissAVVideoItem { return { videoCode: row.video_code, title: row.title, detailPath: row.detail_path, coverUrl: row.cover_url, duration: row.duration || undefined, badge: row.badge || undefined } }
function safeGenres(value: string | null): string[] { try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] } }
function codePrefix(value: string): string { return value.split("-")[0]?.toLowerCase() || "" }
export function tokenize(value: string): string[] { return [...new Set(value.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, " ").split(/\s+/).flatMap(term => [term, ...term.split("-")]).filter(term => term.length >= 2))] }

async function migrateLegacyRecords(db: SQLite.Database): Promise<void> {
  if (Storage.get<boolean>(MIGRATION_KEY)) return
  const favourites = arrayRecords<MissAVFavouriteRecord>(Storage.get<unknown>(OLD_FAVOURITES_KEY))
  const history = arrayRecords<MissAVPlaybackRecord>(Storage.get<unknown>(OLD_HISTORY_KEY))
  for (const item of favourites) { if (!item?.video?.videoCode) continue; await upsertVideo(db, item.video); await db.execute("INSERT OR IGNORE INTO favourites (video_code, added_at) VALUES (?, ?)", [item.video.videoCode, item.addedAt || Date.now()]) }
  for (const item of history) { if (!item?.video?.videoCode) continue; await upsertVideo(db, item.video); const time = item.lastPlayedAt || Date.now(); await db.execute("INSERT OR IGNORE INTO playback_history (video_code, first_played_at, last_played_at, play_count, quality_label) VALUES (?, ?, ?, 1, ?)", [item.video.videoCode, time, time, item.qualityLabel || "自动"] ) }
  Storage.set(MIGRATION_KEY, true)
}
function arrayRecords<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }
