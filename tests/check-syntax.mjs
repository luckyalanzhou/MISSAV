import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
const { babelTransform } = createRequire(import.meta.url)(process.argv[2] || "playwright/lib/transform/babelBundle.js")
let count = 0
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "tests") continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) check(path)
    else if (/\.tsx?$/.test(entry.name)) { babelTransform(readFileSync(path, "utf8"), path, false, [], [], "scripting"); count++ }
  }
}
check(fileURLToPath(new URL("..", import.meta.url)))
console.log(`PASS: ${count} TypeScript/TSX files parsed`)
