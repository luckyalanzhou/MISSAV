import { getMissAVBaseURL, MISSAV_LOCALE } from "./domain"
import { missavClient, type MissAVAccessProbe } from "./client"
import { classifyCloudflareHTML } from "./html-parser"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"
import { captureCloudflareSession, restoreCloudflareSession } from "./cloudflare-session"
import { readMatchingWebViewDocument, type WebViewDocument } from "./webview"

export type MissAVSiteVerificationResult =
  | { status: "accessible"; challengeCompleted: boolean }
  | { status: "incomplete" | "unavailable" | "blocked"; probe: MissAVAccessProbe }

let siteVerificationRequest: Promise<MissAVSiteVerificationResult> | null = null

function origin(): string { return new URL(getMissAVBaseURL()).origin }

export function openMissAVSiteVerification(): Promise<MissAVSiteVerificationResult> {
  if (siteVerificationRequest) return siteVerificationRequest
  const request = runSiteVerification().finally(() => { if (siteVerificationRequest === request) siteVerificationRequest = null })
  siteVerificationRequest = request
  return request
}

async function runSiteVerification(): Promise<MissAVSiteVerificationResult> {
  const finish = missavClient.beginSiteVerification()
  const started = Date.now()
  const target = `${origin()}/${MISSAV_LOCALE}/`
  recordMissAVAccessDiagnostic("verification", target, { state: "started" })
  try {
    const result = await verifySiteProbes()
    recordMissAVAccessDiagnostic("verification", result.status === "accessible" ? target : result.probe.url,
      { state: result.status, elapsedMs: Date.now() - started, challengeObserved: result.status === "accessible" && result.challengeCompleted })
    return result
  } catch (error) {
    recordMissAVAccessDiagnostic("verification", target, { state: "load-error", elapsedMs: Date.now() - started })
    throw error
  } finally { finish() }
}

async function verifySiteProbes(): Promise<MissAVSiteVerificationResult> {
  const verificationOrigin = origin()
  const probe = missavClient.accessProbeRoutes()[0]
  if (!probe) throw new Error("没有可用于检查的访问线路。")
  if (origin() !== verificationOrigin) throw new Error("访问域名已更改，请重新验证。")

  probe.url = missavClient.accessProbeURL(probe)
  const probeURL = probe.url
  const probeHost = new URL(probeURL).hostname
  const controller = new WebViewController()
  try {
    // Open the foreground WebView immediately. A hidden 10-second preflight
    // delayed the challenge UI and duplicated the actual verification request.
    const { listingConfirmed, challengeObserved, blocked, document } = await presentVerificationPage(
      controller,
      probe,
      async () => { await restoreCloudflareSession(controller, probeURL) },
    )
    if (origin() !== verificationOrigin) throw new Error("访问域名已更改，请重新验证。")
    if (blocked) return { status: "blocked", probe }
    try { await captureCloudflareSession(controller, probeHost) } catch { /* Cookie persistence is best-effort. */ }
    if (listingConfirmed && missavClient.cacheVerifiedPage(probe, document)) {
      missavClient.clearVerificationCollections()
      return { status: "accessible", challengeCompleted: challengeObserved }
    }

    // Never retry in the background after the user closes the challenge:
    // success requires observing a real listing in this foreground window.
    const closedPageHTML = (await readMatchingWebViewDocument(controller, probeURL))?.html ?? null
    const closedState = classifyCloudflareHTML(closedPageHTML)
    return { status: closedState === "blocked" ? "blocked" : closedState === "challenge" ? "incomplete" : "unavailable", probe }
  } finally {
    controller.dispose()
  }
}

async function presentVerificationPage(controller: WebViewController, probe: MissAVAccessProbe, restoreCookies: () => Promise<unknown>): Promise<{ listingConfirmed: boolean; challengeObserved: boolean; blocked: boolean; document: WebViewDocument | null }> {
  const probeURL = probe.url
  let presentationClosed = false
  let listingConfirmed = false
  let challengeObserved = false
  let blocked = false
  let confirmedDocument: WebViewDocument | null = null
  const presentation = controller.present({ fullscreen: true, navigationTitle: "验证访问线路" }).finally(() => { presentationClosed = true })

  // Let the modal become visible before navigating so Cloudflare's interactive
  // challenge starts in the foreground on the first tap.
  await new Promise<void>(resolve => setTimeout(resolve, 500))
  if (!presentationClosed) {
    try { await restoreCookies() } catch { /* Continue with the live WebView cookie store. */ }
    if (!presentationClosed) void controller.loadURL(probeURL).catch(() => undefined)
  }

  while (!presentationClosed) {
    await Promise.race([
      new Promise<void>(resolve => setTimeout(resolve, 500)),
      presentation.then(() => undefined),
    ])
    if (presentationClosed) break
    const document = await readMatchingWebViewDocument(controller, probeURL)
    const html = document?.html ?? null
    if (presentationClosed) break

    if (classifyCloudflareHTML(html) === "blocked") { blocked = true; controller.dismiss(); break }
    if (classifyCloudflareHTML(html) === "challenge") challengeObserved = true
    if (isProbePageHTML(html, probe)) {
      listingConfirmed = true
      confirmedDocument = document
      if (!presentationClosed) controller.dismiss()
      break
    }
  }

  await presentation

  // If the user dismissed manually just after the challenge completed, inspect
  // the page already in the WebView before deciding to perform another request.
  if (!listingConfirmed) {
    try {
      const document = await readMatchingWebViewDocument(controller, probeURL)
      const html = document?.html ?? null
      blocked ||= classifyCloudflareHTML(html) === "blocked"
      if (classifyCloudflareHTML(html) === "challenge") challengeObserved = true
      listingConfirmed = isProbePageHTML(html, probe)
      if (listingConfirmed) confirmedDocument = document
    } catch { /* The WebView may already have released its document on dismissal. */ }
  }
  return { listingConfirmed, challengeObserved, blocked, document: confirmedDocument }
}
