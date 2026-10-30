import { getMissAVDatabase } from "../data/database"
import { installMissAVListingCache } from "../site/listing/listing-cache"
import { missavListingCacheDatabase } from "../site/listing/listing-cache-db"
import { removeLegacyMissAVAccountData } from "../data/migrations/removed-account-migration"
import { installSubtitleSearchCache } from "../features/subtitles/subtitle-search-cache"
import { subtitleSearchCacheDatabase } from "../features/subtitles/subtitle-search-cache-db"

let initialized = false

// Shared by the normal script entry and Scripting's Home Tab entry. Keep this
// synchronous apart from the database warm-up so a loader created immediately
// afterwards already has its persistent cache backend installed.
export function initializeMissAVRuntime(): void {
  if (initialized) return
  initialized = true
  installMissAVListingCache(missavListingCacheDatabase)
  installSubtitleSearchCache(subtitleSearchCacheDatabase)
  try { removeLegacyMissAVAccountData() }
  catch { console.error("清理旧会话备份失败，下次启动重试。") }
  void getMissAVDatabase().catch(error => console.error(error))
}
