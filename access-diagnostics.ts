import { MISSAV_DOMAIN_OPTIONS } from "./domain"
import { MISSAV_COLLECTION_OPTIONS } from "./collections"

const MAX_EVENTS = 60
const hosts = MISSAV_DOMAIN_OPTIONS.map(option => new URL(option.value).hostname)
const routes = MISSAV_COLLECTION_OPTIONS.map(option => option.value as string)
const events = ["cookie-restore", "cookie-capture", "page", "verification", "data-task", "lifecycle", "detail"] as const
export const MISSAV_DETAIL_STAGES = ["entered", "verification-wait", "cookie-restore", "page-load", "document-read", "source-parse", "cookie-capture", "detail-parse", "ui-update", "completed", "timeout", "cancelled", "discarded", "failed", "left"] as const
export type MissAVDetailStage = typeof MISSAV_DETAIL_STAGES[number]
const phases = ["subtitle-parse", "subtitle-serialize", "listing-parse", "detail-parse", "dom-compare", "minimize", "resume"] as const
const states = ["live", "recent", "restored", "missing", "invalid", "expired", "scope-mismatch", "rejected", "unconfirmed", "store-unavailable", "unsupported", "saved", "normal", "challenge", "blocked", "unavailable", "cancelled", "load-error", "accessible", "incomplete", "started"] as const
type DiagnosticState = typeof states[number]
type DiagnosticInput = {
  state: DiagnosticState; elapsedMs?: number; attempted?: number; accepted?: number; confirmed?: number;
  clearance?: boolean; expiresInSeconds?: number | null; loaded?: boolean; finished?: boolean;
  challengeObserved?: boolean; cookieState?: DiagnosticState;
  cookieMs?: number; loadMs?: number; captureMs?: number; parseMs?: number; parseCount?: number;
  captureDeferred?: boolean;
  background?: boolean; phase?: typeof phases[number];
  domMatched?: boolean; compactChars?: number;
  detailStage?: MissAVDetailStage; requestId?: number; documentChars?: number; sourceCount?: number;
}
export type MissAVAccessDiagnostic = DiagnosticInput & { at: number; event: typeof events[number]; host: string; route: string }
const history: MissAVAccessDiagnostic[] = []

// Accept only known labels and numeric/boolean fields. Never spread a cookie,
// raw exception, URL query, HTML, or account data into diagnostic output.
export function recordMissAVAccessDiagnostic(event: typeof events[number], target: string, input: DiagnosticInput): void {
  const label = redactedTarget(target)
  const entry: MissAVAccessDiagnostic = {
    at: Date.now(), event: events.includes(event) ? event : "page", ...label,
    state: states.includes(input.state) ? input.state : "unavailable",
  }
  for (const key of ["elapsedMs", "attempted", "accepted", "confirmed", "expiresInSeconds", "cookieMs", "loadMs", "captureMs", "parseMs", "parseCount", "compactChars", "requestId", "documentChars", "sourceCount"] as const) {
    const value = input[key]
    if (typeof value === "number" && Number.isFinite(value)) entry[key] = Math.max(0, Math.round(value))
    else if (key === "expiresInSeconds" && value === null) entry.expiresInSeconds = null
  }
  for (const key of ["clearance", "loaded", "finished", "challengeObserved", "background", "domMatched", "captureDeferred"] as const) {
    if (typeof input[key] === "boolean") entry[key] = input[key]
  }
  if (input.cookieState && states.includes(input.cookieState)) entry.cookieState = input.cookieState
  if (input.phase && phases.includes(input.phase)) entry.phase = input.phase
  if (input.detailStage && MISSAV_DETAIL_STAGES.includes(input.detailStage)) entry.detailStage = input.detailStage
  history.push(entry)
  if (history.length > MAX_EVENTS) history.shift()
  // Normal loads remain quiet. Problems produce a bounded, redacted record in
  // Scripting's console; the in-memory history can be inspected separately.
  if (["challenge", "blocked", "rejected", "unconfirmed", "store-unavailable", "load-error", "unavailable", "incomplete"].includes(entry.state)) {
    try { console.warn("MISSAV access diagnostic", JSON.stringify(entry)) } catch { /* Diagnostics cannot break content loading. */ }
  }
}

export function getMissAVAccessDiagnostics(): MissAVAccessDiagnostic[] { return history.map(entry => ({ ...entry })) }
export function clearMissAVAccessDiagnostics(): void { history.length = 0 }

function redactedTarget(target: string): { host: string; route: string } {
  try {
    const url = new URL(target.includes("://") ? target : `https://${target}/`)
    if (!hosts.includes(url.hostname) || url.username || url.password) return { host: "other", route: "redacted" }
    const path = url.pathname.replace(/^\/dm\d+(?=\/)/i, "").replace(/\/+$/, "")
    const match = path.match(/^\/(cn|ja|en)(?:\/(.*))?$/i)
    if (!match) return { host: url.hostname, route: "redacted" }
    const leaf = match[2] || ""
    if (!leaf) return { host: url.hostname, route: `${match[1]}/home` }
    if (routes.includes(leaf)) return { host: url.hostname, route: `${match[1]}/${leaf}` }
    if (leaf === "search" || leaf.startsWith("search/")) return { host: url.hostname, route: `${match[1]}/search` }
    const directory = ["actresses", "genres", "makers"].find(route => leaf.startsWith(`${route}/`))
    return { host: url.hostname, route: `${match[1]}/${directory ? `${directory}/:category` : ":detail"}` }
  } catch { return { host: "other", route: "redacted" } }
}
