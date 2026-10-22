import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { fileURLToPath } from "node:url"

const policyPath = fileURLToPath(new URL("../src/ui/pages/discover-selection.ts", import.meta.url))
const policySource = stripTypeScriptTypes(readFileSync(policyPath, "utf8"))
const policyURL = `data:text/javascript;base64,${Buffer.from(policySource).toString("base64")}`
const { shouldClearDiscoveryResults } = await import(policyURL)

const cases = [
  {
    name: "refreshing the same collection keeps already visible items",
    input: { queryChanged: true, appendPage: false, forceRefresh: true, sameListing: true, hasItems: true, hasCategories: false },
    expected: false,
  },
  {
    name: "refreshing the same directory keeps already visible categories",
    input: { queryChanged: true, appendPage: false, forceRefresh: true, sameListing: true, hasItems: false, hasCategories: true },
    expected: false,
  },
  {
    name: "switching collection clears results from the previous collection",
    input: { queryChanged: true, appendPage: false, forceRefresh: false, sameListing: false, hasItems: true, hasCategories: false },
    expected: true,
  },
  {
    name: "changing filters clears stale results",
    input: { queryChanged: true, appendPage: false, forceRefresh: false, sameListing: false, hasItems: true, hasCategories: false },
    expected: true,
  },
  {
    name: "loading another page does not clear the existing list",
    input: { queryChanged: true, appendPage: true, forceRefresh: false, sameListing: true, hasItems: true, hasCategories: false },
    expected: false,
  },
  {
    name: "an unchanged query does not clear results",
    input: { queryChanged: false, appendPage: false, forceRefresh: false, sameListing: true, hasItems: true, hasCategories: false },
    expected: false,
  },
]

for (const { name, input, expected } of cases) {
  assert.equal(shouldClearDiscoveryResults(input), expected, name)
}

console.log(`PASS: ${cases.length} discovery result-retention behaviors`)
