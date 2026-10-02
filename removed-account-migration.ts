const MIGRATION_KEY = "missav_removed_website_account_v1"
const LEGACY_ACCOUNT_KEYS = [
  "missav_account_cookie_v2_missav_ws",
  "missav_account_meta_v2_missav_ws",
  "missav_account_cookie_v2_missav_ai",
  "missav_account_meta_v2_missav_ai",
]
// Delete only this script's obsolete account backups. Do not clear shared
// WebView cookies: they also hold route clearance and unrelated site settings.
// No native async operation here may delay opening the home page.
export function removeLegacyMissAVAccountData(): void {
  if (Storage.get<boolean>(MIGRATION_KEY)) return
  for (const key of LEGACY_ACCOUNT_KEYS) Keychain.remove(key)
  Storage.set(MIGRATION_KEY, true)
}
