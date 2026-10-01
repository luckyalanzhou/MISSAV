export type WebViewPageLoad = {
  loaded: boolean
  finished: boolean
  html: string | null
}

type WebViewSearchSubmissionResult = {
  submitted?: boolean
  inputCount?: number
  title?: string
  url?: string
  pageText?: string
}

const WEBVIEW_PAGE_LOAD_TIMEOUT_MS = 30_000
const WEBVIEW_HTML_READ_ATTEMPTS = 10
const WEBVIEW_HTML_READ_INTERVAL_MS = 300

export async function loadWebViewPage(controller: WebViewController, url: string, timeoutMs = WEBVIEW_PAGE_LOAD_TIMEOUT_MS): Promise<WebViewPageLoad> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeoutError = new Error("网页加载超时，请检查网络后重试。")
  try {
    return await Promise.race([
      (async () => {
        let loaded = false
        let finished = false
        let loadError: unknown
        try { loaded = await controller.loadURL(url) } catch (error) { loadError = error }
        if (timedOut) throw timeoutError
        if (loaded) {
          try { finished = await controller.waitForLoad() } catch { /* A redirect can cancel a load callback. */ }
        }
        for (let attempt = 0; attempt < WEBVIEW_HTML_READ_ATTEMPTS; attempt += 1) {
          if (timedOut) throw timeoutError
          let html: string | null = null
          try { html = await controller.getHTML() } catch { /* The document may be between navigations. */ }
          if (timedOut) throw timeoutError
          if (!hasWebViewDocument(html)) {
            try { html = await controller.evaluateJavaScript<string | null>("return document.documentElement ? document.documentElement.outerHTML : null") }
            catch { /* JavaScript is unavailable while the new document is being created. */ }
          }
          if (timedOut) throw timeoutError
          if (hasWebViewDocument(html)) return { loaded, finished, html }
          if (attempt + 1 < WEBVIEW_HTML_READ_ATTEMPTS) await new Promise<void>(resolve => setTimeout(resolve, WEBVIEW_HTML_READ_INTERVAL_MS))
        }
        if (loadError) throw loadError
        return { loaded, finished, html: null }
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => { timedOut = true; reject(timeoutError) }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function hasWebViewDocument(html: string | null): html is string {
  return Boolean(html && html
    .replace(/<(head|script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, "")
    .trim())
}

export async function submitWebViewSearch(controller: WebViewController, value: string, sourceName: string): Promise<void> {
  const result = await controller.evaluateJavaScript<WebViewSearchSubmissionResult>(`
    return (async () => {
      const value = ${JSON.stringify(value)};
      const deadline = Date.now() + 8000;
      const selectors = 'input, textarea, [role="searchbox"], [contenteditable="true"]';
      const isVisible = element => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          && (element.getClientRects().length > 0 || element.offsetWidth > 0 || element.offsetHeight > 0);
      };
      const describe = element => [element.placeholder, element.name, element.id,
        element.getAttribute("aria-label"), element.getAttribute("title"),
        element.getAttribute("data-testid")].filter(Boolean).join(" ");
      const findField = () => {
        const candidates = Array.from(document.querySelectorAll(selectors))
          .filter(element => {
            if (!isVisible(element) || element.disabled || element.readOnly) return false;
            if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
            const type = (element.type || "text").toLowerCase();
            return ["text", "search", "", "url"].includes(type);
          });
        candidates.sort((left, right) => {
          const score = element => /search|subtitle|code|number|番号/i.test(describe(element)) ? 1 : 0;
          return score(right) - score(left);
        });
        return { candidates, field: candidates[0] };
      };

      let found = findField();
      while (!found.field && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        found = findField();
      }
      if (!found.field) {
        return {
          submitted: false,
          inputCount: document.querySelectorAll(selectors).length,
          title: document.title || "",
          url: location.href,
          pageText: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 180),
        };
      }

      const field = found.field;
      field.focus();
      if (field.isContentEditable) {
        field.textContent = value;
      } else {
        const prototype = Object.getPrototypeOf(field);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor?.set) descriptor.set.call(field, value);
        else field.value = value;
      }
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));

      const form = field.form || field.closest("form");
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return { submitted: true };
      }
      const scope = field.parentElement?.parentElement || document;
      const button = Array.from(scope.querySelectorAll('button, input[type="submit"], [role="button"]')).find(element =>
        /search|find|搜索/i.test([element.innerText || "", element.value || "", element.getAttribute("aria-label") || "", element.title || ""].join(" "))
      );
      if (button) {
        button.click();
        return { submitted: true };
      }
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      return { submitted: true };
    })()
  `)

  if (result?.submitted) return
  const inputCount = typeof result?.inputCount === "number" ? result.inputCount : 0
  const title = typeof result?.title === "string" && result.title ? ` 页面标题：${result.title.slice(0, 80)}。` : ""
  const pageText = typeof result?.pageText === "string" ? result.pageText : ""
  if (/just a moment|verify you are human|checking your browser|security verification|请验证您是真人/i.test(pageText)) {
    throw new Error(`${sourceName} 当前显示安全验证页面，请先完成验证后重试。`)
  }
  const reason = inputCount ? `页面检测到 ${inputCount} 个控件，但没有可用的搜索输入框。` : "当前页面没有显示搜索输入框。"
  throw new Error(`${sourceName} 无法自动定位搜索框：${reason}${title}请稍后重试。`)
}
