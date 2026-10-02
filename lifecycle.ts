import { recordMissAVAccessDiagnostic } from "./access-diagnostics"

export type MissAVLifecycleEvent = { kind: "minimize" | "resume"; minimizedForMs: number }
type LifecycleHost = {
  onMinimize?: (callback: () => void) => () => void
  onResume: (callback: (details: { resumeFromMinimized: boolean }) => void) => () => void
}
const listeners = new Set<(event: MissAVLifecycleEvent) => void>()

export function subscribeMissAVLifecycle(listener: (event: MissAVLifecycleEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Script.onResume is a live-instance resume/retrigger event, NOT a general
// iOS foreground notification. Do not rebuild the UI or initiate site checks.
export function installMissAVLifecycle(host: LifecycleHost): () => void {
  let minimizedAt: number | null = null
  let disposed = false
  const emit = (event: MissAVLifecycleEvent) => {
    recordMissAVAccessDiagnostic("lifecycle", "runtime", { state: "normal", phase: event.kind, elapsedMs: event.minimizedForMs })
    for (const listener of [...listeners]) {
      try { listener({ ...event }) } catch { /* One consumer must not interrupt other lifecycle owners. */ }
    }
  }
  const removeMinimize = host.onMinimize?.(() => {
    if (disposed || minimizedAt !== null) return
    minimizedAt = Date.now()
    emit({ kind: "minimize", minimizedForMs: 0 })
  })
  const removeResume = host.onResume(details => {
    if (disposed || !details.resumeFromMinimized) return
    // A second external trigger must not masquerade as another restore.
    if (minimizedAt === null) return
    const minimizedForMs = Math.max(0, Date.now() - minimizedAt)
    minimizedAt = null
    emit({ kind: "resume", minimizedForMs })
  })
  return () => {
    if (disposed) return
    disposed = true
    try { removeMinimize?.() } finally { removeResume() }
  }
}
