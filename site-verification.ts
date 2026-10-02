import { getMissAVBaseURL, MISSAV_LOCALE } from "./domain"
import { isCloudflareChallengeHTML as isCloudflareHTML, isLikelyMissAVHTML, isLikelyMissAVListingHTML, isMissAVDirectoryCollection, missavClient, parseMissAVDirectoryPage, type MissAVAccessProbe } from "./client"
import { classifyCloudflareHTML } from "./html-parser"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"
import { captureCloudflareSession, restoreCloudflareSession } from "./cloudflare-session"
import { loadWebViewPage, readMatchingWebViewDocument, type WebViewPageLoad, type WebViewDocument } from "./webview"

export type MissAVSiteVerificationResult =
  | { status: "accessible"; challengeCompleted: boolean }
  | { status: "incomplete" | "unavailable" | "blocked"; probe: MissAVAccessProbe }

const MISSAV_ACCESS_PROBE_TIMEOUT_MS = 10_000
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
  let challengeCompleted = false
  // Check real group entries and recently challenged subcategories.
  // Group headings are never treated as page URLs.
  for (const probe of missavClient.accessProbeRoutes()) {
    if (origin() !== verificationOrigin) throw new Error("访问域名已更改，请重新验证。")
    // Share cookies, not the preceding probe's document. A cancelled load
    // must never validate the next route using the previous listing's HTML.
    let controller = new WebViewController()
    try {
      // The preceding listing can reveal updated routes for the next probes.
      probe.url = missavClient.accessProbeURL(probe)
      const probeURL = probe.url
      const probeHost = new URL(probeURL).hostname
      await restoreCloudflareSession(controller, probeURL)
      let initialPage: WebViewPageLoad = { loaded: false, finished: false, html: null }
      try { initialPage = await loadWebViewPage(controller, probeURL, MISSAV_ACCESS_PROBE_TIMEOUT_MS) }
      catch {
        const document = await readMatchingWebViewDocument(controller, probeURL)
        initialPage = { loaded: false, finished: false, html: document?.html ?? null, url: document?.url }
      }
      if (origin() !== verificationOrigin) throw new Error("访问域名已更改，请重新验证。")

      // The HTML is the source of truth; WebKit can report a redirect callback
      // as incomplete even though a usable list is already on screen.
      if (classifyCloudflareHTML(initialPage.html) === "blocked") return { status: "blocked", probe }
      const initialChallenge = classifyCloudflareHTML(initialPage.html) === "challenge"
      if (initialPage.challengeObserved && !initialChallenge) challengeCompleted = true
      const needsVisibleCheck = initialChallenge || !isProbePageHTML(initialPage.html, probe)
      if (needsVisibleCheck) {
        // Discard the hidden document, not its shared cookies. A challenge
        // initialized off-screen can retain a stalled widget when reused.
        // Start the exact route once in a fresh foreground WebView instead.
        controller.dispose()
        controller = new WebViewController()
        await restoreCloudflareSession(controller, probeURL)
        const { listingConfirmed: visibleListingConfirmed, challengeObserved, blocked, document } = await presentVerificationPage(controller, probe)
        if (origin() !== verificationOrigin) throw new Error("访问域名已更改，请重新验证。")
        if (blocked) return { status: "blocked", probe }
        try { await captureCloudflareSession(controller, probeHost) } catch { /* Cookie persistence is best-effort. */ }
        if (visibleListingConfirmed) {
          if (initialChallenge || challengeObserved) challengeCompleted = true
          if (!missavClient.cacheVerifiedPage(probe, document)) return { status: "unavailable", probe }
          continue
        }

        // Never retry in the background after the user closes the challenge:
        // doing so can finish later and falsely report that the closed page was
        // verified. Success requires observing a real listing in this window.
        const closedPageHTML = (await readMatchingWebViewDocument(controller, probeURL))?.html ?? null
        const closedState = classifyCloudflareHTML(closedPageHTML)
        return { status: closedState === "blocked" ? "blocked" : closedState === "challenge" ? "incomplete" : "unavailable", probe }
      }
      if (!missavClient.cacheVerifiedPage(probe, { url: initialPage.url || probeURL, html: initialPage.html })) return { status: "unavailable", probe }
      try { await captureCloudflareSession(controller, probeHost) } catch { /* Cookie persistence is best-effort. */ }
    } finally { controller.dispose() }
  }
  missavClient.clearVerificationCollections()
  return { status: "accessible", challengeCompleted }
}

function isProbePageHTML(html: string | null, probe: MissAVAccessProbe): boolean {
  if (!isLikelyMissAVHTML(html) || isCloudflareHTML(html)) return false
  return isMissAVDirectoryCollection(probe.collection) && !probe.params.categoryPath && !probe.params.query
    ? Boolean(parseMissAVDirectoryPage(html, 1, probe.collection, probe.url).categories?.length)
    : isLikelyMissAVListingHTML(html)
}

async function presentVerificationPage(controller: WebViewController, probe: MissAVAccessProbe): Promise<{ listingConfirmed: boolean; challengeObserved: boolean; blocked: boolean; document: WebViewDocument | null }> {
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
  if (!presentationClosed) void controller.loadURL(probeURL).catch(() => undefined)

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
