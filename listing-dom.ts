import type { MissAVSearchPage } from "./client"
import { recordMissAVAccessDiagnostic } from "./access-diagnostics"

// Shadow/consistency trial only. Do not change the production extraction path
// before comparing actual iPhone WebKit snapshots with the HTML parser.
let trialEnabled = false
export function setMissAVDOMExtractionTrialEnabled(enabled: boolean): void { trialEnabled = enabled }
export function isMissAVDOMExtractionTrialEnabled(): boolean { return trialEnabled }

// Read both representations and location in one existing WebView evaluation.
// No navigation, separate cookie jar, hidden iframe or site mutation.
export const MISSAV_DOM_DOCUMENT_SCRIPT = `
  const html = document.documentElement ? document.documentElement.outerHTML : null;
  let compactHTML = null;
  try {
    const root = document.querySelector('main') || document.body;
    if (root) {
      const heading = root.querySelector('h1');
      const anchors = Array.from(root.querySelectorAll('a[href]'))
        .filter(anchor => !anchor.closest('footer, script, style, template'));
      if (anchors.length <= 6000) {
        compactHTML = '<html><body>MISSAV' + (heading ? heading.outerHTML : '')
          + anchors.map(anchor => anchor.outerHTML).join('\\n') + '</body></html>';
        if (compactHTML.length > 2000000) compactHTML = null;
      }
    }
  } catch (_) { compactHTML = null; }
  return { url: window.location.href, html, compactHTML };
`

export function selectMissAVDOMPage(target: string, fullPage: MissAVSearchPage, compactHTML: string | undefined, parse: (html: string) => MissAVSearchPage): MissAVSearchPage {
  if (!trialEnabled || !compactHTML) return fullPage
  const started = Date.now()
  let domMatched = false
  try {
    const candidate = parse(compactHTML)
    // Exact title/order/covers/duration/categories/pagination equivalence,
    // not merely equal item counts. Empty extractions cannot validate a page.
    domMatched = Boolean(candidate.items.length || candidate.categories?.length) && JSON.stringify(candidate) === JSON.stringify(fullPage)
    return domMatched ? candidate : fullPage
  } catch { return fullPage }
  finally { recordMissAVAccessDiagnostic("data-task", target, { state: "normal", phase: "dom-compare", domMatched, compactChars: compactHTML.length, elapsedMs: Date.now() - started }) }
}
