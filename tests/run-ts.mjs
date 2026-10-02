import { compileProductionModule } from "./production-module.mjs"
globalThis.Storage = { get: () => undefined, set() {} }
try { await import(compileProductionModule(new URL(process.argv[2], import.meta.url))) }
catch (error) { console.error(error.message); process.exitCode = 1 }
