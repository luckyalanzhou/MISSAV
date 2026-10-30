import { getMissAVDatabase } from "../../data/database"

const MAX_RECORDS = 50

export const subtitleSearchCacheDatabase = {
  async read(code: string): Promise<string | null> {
    const db = await getMissAVDatabase()
    const row = await db.fetchOne<{ payload: string }>("SELECT payload FROM subtitle_search_cache WHERE cache_code = ?", [code])
    return row?.payload ?? null
  },
  async write(code: string, payload: string, touchedAt: number): Promise<void> {
    const db = await getMissAVDatabase()
    await db.transaction([
      { sql: "INSERT INTO subtitle_search_cache (cache_code, payload, touched_at) VALUES (?, ?, ?) ON CONFLICT(cache_code) DO UPDATE SET payload=excluded.payload, touched_at=excluded.touched_at", args: [code, payload, touchedAt] },
      { sql: `DELETE FROM subtitle_search_cache WHERE cache_code NOT IN (
        SELECT cache_code FROM subtitle_search_cache ORDER BY touched_at DESC, cache_code LIMIT ${MAX_RECORDS}
      )` },
    ])
  },
}
