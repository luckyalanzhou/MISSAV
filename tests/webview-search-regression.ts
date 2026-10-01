import { Script } from "scripting"
import { submitWebViewSearch } from "../webview"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = async (): Promise<void> => {
  let submitted = false
  const events: string[] = []
  const form = { requestSubmit: () => { submitted = true }, submit: () => { submitted = true } }
  const inputPrototype = Object.create(null) as Record<string, unknown>
  Object.defineProperty(inputPrototype, "value", {
    get(this: { valueText?: string }) { return this.valueText || "" },
    set(this: { valueText?: string }, value: string) { this.valueText = value },
  })
  const field = Object.create(inputPrototype) as Record<string, any>
  Object.assign(field, {
    type: "search",
    tagName: "INPUT",
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    placeholder: "Search subtitle",
    form,
    focus: () => {},
    getAttribute: () => null,
    getClientRects: () => [{}],
    dispatchEvent: (event: Event) => { events.push(event.type); return true },
    closest: () => form,
  })
  const document = {
    title: "Subtitle search",
    body: { innerText: "Search subtitle files" },
    querySelectorAll: () => [field],
  }
  const window = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) }
  const controller = {
    evaluateJavaScript: async (javascript: string) => {
      assert(/^\s*return\s+\(/.test(javascript), "WebView script must explicitly return its asynchronous result")
      return await new Function("document", "window", "location", javascript)(document, window, { href: "https://www.subtitlecat.com/" })
    },
  } as unknown as WebViewController

  await submitWebViewSearch(controller, "FNS-258", "Subtitle Cat")
  assert(field.value === "FNS-258", "搜索番号必须通过原生 value setter 写入输入框")
  assert(events.includes("input") && events.includes("change"), "写入搜索框后应派发 input/change 事件")
  assert(submitted, "识别到表单后应提交搜索")

  const failedController = {
    evaluateJavaScript: async () => ({ submitted: false, inputCount: 1, title: "Security check", pageText: "" }),
  } as unknown as WebViewController
  let failure = ""
  try { await submitWebViewSearch(failedController, "FNS-258", "JavSub.ai") }
  catch (error) { failure = error instanceof Error ? error.message : String(error) }
  assert(failure.includes("JavSub.ai") && failure.includes("Security check"), "搜索控件缺失时应提供来源和页面诊断，不能误报为无结果")
}

run().then(
  () => Script.exit({ passed: 4, message: "WebView subtitle search regression tests passed" }),
  error => Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }),
)
