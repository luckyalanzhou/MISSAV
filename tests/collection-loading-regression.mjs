import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const clientPath = fileURLToPath(new URL("../client.ts", import.meta.url))
const discoverPath = fileURLToPath(new URL("../page/discover.tsx", import.meta.url))
const clientSource = readFileSync(clientPath, "utf8")
const discoverSource = readFileSync(discoverPath, "utf8")

// Run the real route builders without requiring the iOS-only scripting module.
const locale = clientSource.match(/export const MISSAV_LOCALE = "([^"]+)"/)?.[1]
const routeBody = clientSource.match(/private collectionUrl\(params: MissAVSearchParams\): string \{([\s\S]*?)\n  \}/)?.[1]
const probeBody = clientSource.match(/accessProbeRoutes\(\): MissAVAccessProbe\[\] \{([\s\S]*?)\n  \}/)?.[1]
const sortBody = clientSource.match(/function collectionProbeSort\(collection: MissAVCollection\): MissAVSort \{([\s\S]*?)\n\}/)?.[1]
const optionsLiteral = clientSource.match(/export const MISSAV_COLLECTION_OPTIONS:[^\n]* = (\[[\s\S]*?\n\])/)?.[1]
assert.ok(routeBody && probeBody && sortBody && optionsLiteral, "The production route builders and collection catalog must be available")
assert.equal(locale, "ja")
const options = new Function(`return ${optionsLiteral}`)()
const buildRoute = new Function("params", "MISSAV_LOCALE", "getMissAVBaseURL", routeBody)
const probeSort = new Function("collection", sortBody)
const buildProbes = new Function("MISSAV_COLLECTION_OPTIONS", "collectionProbeSort", probeBody)
for (const baseURL of ["https://missav.ws/", "https://missav.ai/"]) {
  const collectionUrl = params => buildRoute(params, locale, () => baseURL)
  for (const { value } of options) {
    const route = new URL(collectionUrl({ collection: value, page: 2, sort: "released_at", filter: "individual" }))
    assert.equal(route.origin, new URL(baseURL).origin)
    assert.equal(route.pathname, `/ja/${value}`, `${value} must use the shared Japanese route`)
    assert.equal(route.searchParams.get("page"), "2")
    assert.equal(route.searchParams.get("filters"), "individual")
  }
  assert.equal(new URL(collectionUrl({ query: "FNS-258" })).pathname, "/ja/search/FNS-258")
  const probes = buildProbes.call({ collectionUrl }, options, probeSort)
  assert.deepEqual(probes.map(probe => probe.collection), options.filter(option => option.value !== "english-subtitle").map(option => option.value), "The optional English subtitle listing must not block access verification")
  for (const probe of probes) {
    const route = new URL(probe.url)
    assert.equal(route.pathname, `/ja/${probe.collection}`)
    const hotSorts = { "today-hot": "today_views", "weekly-hot": "weekly_views", "monthly-hot": "monthly_views" }
    assert.equal(route.searchParams.get("sort"), hotSorts[probe.collection] || "released_at")
  }
}
assert.match(clientSource, /if \(SiteHTML\.isLikelyMissAVHTML\(html\)\) return html[\s\S]*?if \(!loaded \|\| !finished \|\| !html\)/)
assert.match(discoverSource, /collection: item\.value, sort: defaultCollectionSort\(item\.value\)/)
assert.match(discoverSource, /if \(collection === "today-hot"\) return "today_views"[\s\S]*?if \(collection === "weekly-hot"\) return "weekly_views"[\s\S]*?if \(collection === "monthly-hot"\) return "monthly_views"/)

console.log("MISSAV collection loading regression test passed")
