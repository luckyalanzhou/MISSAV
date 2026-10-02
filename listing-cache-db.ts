import { getMissAVDatabase } from "./database"
import type { CachedListing } from "./listing-cache"

export const missavListingCacheDatabase = {
  async read(key: string): Promise<unknown> {
    const db = await getMissAVDatabase()
    const row = await db.fetchOne<{ payload: string; saved_at: number }>("SELECT payload, saved_at FROM listing_cache WHERE cache_key = ?", [key])
    if (!row || row.payload.length > 2_000_000) return null
    try { return { savedAt: row.saved_at, value: JSON.parse(row.payload) } } catch { return null }
  },
  async write(key: string, record: CachedListing): Promise<void> {
    const payload = JSON.stringify(record.value)
    if (payload.length > 2_000_000) return
    const db = await getMissAVDatabase()
    await db.transaction([
      { sql: "INSERT INTO listing_cache (cache_key, payload, saved_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at", args: [key, payload, record.savedAt] },
      // This bound applies only to page snapshots, never downloaded subtitles.
      { sql: "DELETE FROM listing_cache WHERE cache_key NOT IN (SELECT cache_key FROM listing_cache ORDER BY saved_at DESC, cache_key LIMIT 48)" },
    ])
  },
}
