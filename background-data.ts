import { recordMissAVAccessDiagnostic } from "./access-diagnostics"

export type MissAVDataTask = "subtitle-parse" | "subtitle-serialize"

// Only pure computation belongs here. Native UI, Storage, WebView and file I/O
// stay on the caller's thread; async native I/O already uses host scheduling.
export async function runMissAVDataTask<T>(phase: MissAVDataTask, compute: () => T): Promise<T> {
  const started = Date.now()
  const background = typeof Thread !== "undefined" && typeof Thread.runInBackground === "function"
  let state: "normal" | "load-error" = "load-error"
  try {
    const value = background ? await Thread.runInBackground(compute) : compute()
    state = "normal"
    return value
  } finally {
    // Only labels/timings cross into diagnostics, never subtitle text or paths.
    recordMissAVAccessDiagnostic("data-task", "runtime", { state, phase, background, elapsedMs: Date.now() - started })
  }
}
