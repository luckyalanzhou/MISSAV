import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const clientPath = fileURLToPath(new URL("../client.ts", import.meta.url))
const discoverPath = fileURLToPath(new URL("../page/discover.tsx", import.meta.url))
const clientSource = readFileSync(clientPath, "utf8")
const discoverSource = readFileSync(discoverPath, "utf8")

assert.match(clientSource, /const collectionLocale = !query && params\.collection === "english-subtitle" \? "en" : MISSAV_LOCALE/)
assert.match(clientSource, /if \(SiteHTML\.isLikelyMissAVHTML\(html\)\) return html[\s\S]*?if \(!loaded \|\| !finished \|\| !html\)/)
assert.match(discoverSource, /collection: item\.value, sort: defaultCollectionSort\(item\.value\)/)
assert.match(discoverSource, /if \(collection === "today-hot"\) return "today_views"[\s\S]*?if \(collection === "weekly-hot"\) return "weekly_views"[\s\S]*?if \(collection === "monthly-hot"\) return "monthly_views"/)

console.log("MISSAV collection loading regression test passed")
