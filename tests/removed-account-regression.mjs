import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { compileProductionModule } from "./production-module.mjs"

const root = new URL("../", import.meta.url)
const keys = [
  "missav_account_cookie_v2_missav_ws", "missav_account_meta_v2_missav_ws",
  "missav_account_cookie_v2_missav_ai", "missav_account_meta_v2_missav_ai",
]
const source = file => readFileSync(new URL(file, root), "utf8")
assert.equal(existsSync(fileURLToPath(new URL("account.ts", root))), false)
for (const file of ["page/settings.tsx", "page/detail.tsx", "page/library.tsx", "page/index.tsx", "home_screen_default_ui.tsx"]) {
  assert.doesNotMatch(source(file), /(?:\.\.\/|\.\/)account["']|onAccountChanged|accountRevision|loadMissAVSavedVideos|WebsiteSaved|loginMissAV|网站收藏|网站账号/)
}
assert.match(source("page/settings.tsx"), /site-verification/)
assert.match(source("page/settings.tsx"), /验证访问线路/)
assert.match(source("page/library.tsx"), /formatMissAVContinueWatching/)
assert.match(source("index.tsx"), /removeLegacyMissAVAccountData\(\)/)
assert.match(source("home_screen_default_ui.tsx"), /removeLegacyMissAVAccountData\(\)/)

const stored = new Map()
const secrets = new Map(keys.map(key => [key, "fixture"]))
secrets.set("missav_cloudflare_cookie_fixture", "clearance")
secrets.set("unrelated_script_key", "untouched")
const removed = []
let fail = true
globalThis.Storage = { get: key => stored.get(key), set: (key, value) => stored.set(key, value) }
globalThis.Keychain = { remove(key) {
  assert.ok(keys.includes(key), "Cleanup only touches obsolete account backups")
  if (fail && key === keys[2]) throw new Error("Fixture locked keychain")
  secrets.delete(key); removed.push(key)
} }
globalThis.WebViewController = class { constructor() { throw new Error("Account cleanup must not create native WebView work") } }
const { removeLegacyMissAVAccountData } = await import(compileProductionModule(new URL("../removed-account-migration.ts", import.meta.url)))
assert.throws(() => removeLegacyMissAVAccountData(), /locked keychain/)
assert.equal(stored.size, 0, "Failed cleanup is retried instead of marking done")
fail = false
assert.equal(removeLegacyMissAVAccountData(), undefined, "Cleanup is synchronous and cannot await native promises")
keys.forEach(key => assert.equal(secrets.has(key), false))
assert.equal(secrets.get("missav_cloudflare_cookie_fixture"), "clearance")
assert.equal(secrets.get("unrelated_script_key"), "untouched")
const count = removed.length
removeLegacyMissAVAccountData()
assert.equal(removed.length, count, "Migration is idempotent")
console.log("PASS: account feature removed, local history and verification retained; scoped nonblocking legacy backup cleanup")
