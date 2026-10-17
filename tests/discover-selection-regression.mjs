import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const discoverPath = fileURLToPath(new URL("../page/discover.tsx", import.meta.url))
const discoverSource = readFileSync(discoverPath, "utf8")

assert.match(discoverSource, /const query = useRef<\{ page: number; collection: MissAVCollection; filter: MissAVFilter; sort: MissAVSort; categoryPath: string \}>/)
assert.match(discoverSource, /query\.current = nextQuery[\s\S]*?setPage\(nextQuery\.page\); setCollection\(nextQuery\.collection\); setFilter\(nextQuery\.filter\); setSort\(nextQuery\.sort\)/)
assert.match(discoverSource, /if \(queryChanged && !appendPage\) \{ setItems\(\[\]\); setCategories\(\[\]\); setHasNext\(true\); setFailedPage\(null\) \}/)
assert.match(discoverSource, /setItems\(current => mergeUnique\(current, result\.items, item => item\.videoCode\)\)/)
assert.match(discoverSource, /function loadNextPageIfNeeded\(\)/)
assert.doesNotMatch(discoverSource, /title="上一页"|title="下一页"/)
assert.match(discoverSource, /function CategoryChip[\s\S]*?frame=\{\{ minHeight: 44 \}\} contentShape="rect"/)

console.log("MISSAV discover selection regression test passed")

