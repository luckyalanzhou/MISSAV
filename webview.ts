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

export async function loadWebViewPage(controller: WebViewController, url: string, timeoutMs = WEBVIEW_PAGE_LOAD_TIMEOUT_MS): Promise<WebViewPageLoad> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const loaded = await controller.loadURL(url)
        const finished = loaded ? await controller.waitForLoad() : false
        const html = await controller.getHTML()
        return { loaded, finished, html }
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("网页加载超时，请检查网络后重试。")), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
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
