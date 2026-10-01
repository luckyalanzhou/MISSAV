import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { compileProductionModule as compile } from "./production-module.mjs"

const storage = new Map()
globalThis.Storage = { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }
const { missavClient, MISSAV_FILTER_OPTIONS, MISSAV_SORT_OPTIONS } = await import(compile("../client.ts"))
const { setMissAVBaseURL, MISSAV_LOCALE } = await import(compile("../domain.ts"))
const { MISSAV_COLLECTION_OPTIONS: options, MISSAV_COLLECTION_GROUPS: groups, collectionOptionsForGroup, defaultMissAVCollectionSort, isMissAVDirectoryCollection } = await import(compile("../collections.ts"))
const discoverSource = readFileSync(new URL("../page/discover.tsx", import.meta.url), "utf8")
const searchSource = readFileSync(new URL("../page/search.tsx", import.meta.url), "utf8")

assert.equal(MISSAV_LOCALE, "cn")
assert.deepEqual(groups.map(group => group.title), ["中文字幕", "日本 AV", "素人", "无码影片", "亚洲 AV"])
assert.deepEqual(collectionOptionsForGroup("subtitles").map(option => option.value), ["chinese-subtitle"])
assert.deepEqual(collectionOptionsForGroup("amateur").map(option => option.value), ["siro", "luxu", "gana", "maan", "scute", "ara"])
assert.equal(collectionOptionsForGroup("uncensored").length, 14)
assert.deepEqual(collectionOptionsForGroup("asian").map(option => option.value), ["madou", "twav", "furuke", "klive", "clive"])
assert.equal(options.length, 36)
assert.equal(new Set(options.map(option => option.value)).size, options.length)
assert.ok(!options.some(option => option.value === "english-subtitle"))
for (const group of groups) assert.ok(group.collections.includes(group.defaultCollection))
for (const option of options) assert.ok(groups.some(group => group.collections.includes(option.value)), `${option.value} must belong to a visible group`)
assert.deepEqual(MISSAV_FILTER_OPTIONS.map(option => option.value), ["", "individual", "multiple", "chinese-subtitle"])

let checked = 0
for (const baseURL of ["https://missav.ws/", "https://missav.ai/"]) {
  setMissAVBaseURL(baseURL)
  const client = new missavClient.constructor()
  for (const { value: collection } of options) {
    for (const { value: filter } of MISSAV_FILTER_OPTIONS) {
      for (const { value: sort } of MISSAV_SORT_OPTIONS) {
        const route = new URL(client.collectionUrl({ collection, filter, sort, page: 3 }))
        assert.equal(route.origin, new URL(baseURL).origin)
        assert.equal(route.pathname, `/cn/${collection}`)
        assert.equal(route.searchParams.get("page"), "3")
        const directory = isMissAVDirectoryCollection(collection)
        assert.equal(route.searchParams.get("filters"), directory ? null : filter || null)
        assert.equal(route.searchParams.get("sort"), directory ? null : sort)
        checked++
      }
    }
  }
  assert.equal(new URL(client.collectionUrl({ query: "FNS-258" })).pathname, "/cn/search/FNS-258")
  const probes = client.accessProbeRoutes()
  assert.deepEqual(probes.map(probe => probe.collection), groups.map(group => group.defaultCollection))
  for (const probe of probes) {
    const route = new URL(probe.url)
    assert.equal(route.pathname, `/cn/${probe.collection}`)
    assert.equal(route.searchParams.get("sort"), defaultMissAVCollectionSort(probe.collection))
  }
  client.verificationRequests.set(`${baseURL}cn/heyzo`, { collection: "heyzo" })
  client.verificationRequests.set(`${baseURL}cn/genres/example`, { collection: "genres", categoryPath: "/cn/genres/example" })
  client.verificationRequests.set("https://other.example/cn/release", { collection: "release" })
  assert.deepEqual(client.accessProbeRoutes().slice(-2).map(probe => probe.collection), ["heyzo", "genres"])
  assert.equal(new URL(client.accessProbeRoutes().at(-1).url).pathname, "/cn/genres/example", "Verify the challenged directory leaf, not its accessible root")
  client.clearVerificationCollections()
  assert.equal(client.accessProbeRoutes().length, 5)
  for (const categoryPath of ["https://other.example/cn/genres/VR", "/ja/genres/VR", "/cn/actresses/ranking", "/cn/actresses/ranking/"]) {
    assert.throws(() => client.collectionUrl({ collection: "genres", categoryPath }), /分类链接不属于/)
  }
}
assert.equal(checked, 2016)
assert.equal(defaultMissAVCollectionSort("new"), "published_at")
assert.equal(defaultMissAVCollectionSort("today-hot"), "today_views")
assert.equal(defaultMissAVCollectionSort("weekly-hot"), "weekly_views")
assert.equal(defaultMissAVCollectionSort("monthly-hot"), "monthly_views")
assert.match(discoverSource, /MISSAV_COLLECTION_GROUPS\.map/)
assert.match(discoverSource, /subcollections\.length > 1/)
assert.match(discoverSource, /collection: value, categoryPath: "", filter: "", sort: defaultCollectionSort\(value\)/)
assert.match(discoverSource, /categoryPath: item\.path/)
assert.doesNotMatch(searchSource, /english-subtitle/)
assert.match(searchSource, /collection: "chinese-subtitle"/)

console.log(`MISSAV five browse groups and ${checked} Chinese route/filter/sort cases passed`)
