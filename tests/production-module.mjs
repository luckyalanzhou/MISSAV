import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"

const modules = new Map()
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
const scriptingStub = moduleURL(`
  export const Path = { join: (...parts) => parts.join("/") }
  export function fetch() { throw new Error("Unexpected HTTP fetch") }
  export const Script = { exit(result) {
    if (!result.passed || result.error) throw new Error(result.error || "Regression failed")
    console.log(result.message)
  } }
`)

// Execute the actual TS modules, substituting only the iOS-only bridge.
export function compileProductionModule(relative) {
  const url = new URL(relative, import.meta.url)
  if (modules.has(url.href)) return modules.get(url.href)
  const source = stripTypeScriptTypes(readFileSync(url, "utf8"))
    .replace(/\bfrom\s+["']([^"']+)["']/g, (_, specifier) => {
      const dependency = specifier === "scripting" ? scriptingStub : compileProductionModule(new URL(`${specifier}.ts`, url))
      return `from ${JSON.stringify(dependency)}`
    })
  const compiled = moduleURL(source)
  modules.set(url.href, compiled)
  return compiled
}
