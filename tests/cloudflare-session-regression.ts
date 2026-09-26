import { Script } from "scripting"
import { cloudflareCookiesForHost, isCloudflareSessionCookie } from "../cloudflare-session"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const run = (): void => {
  const cookies = [
    { name: "cf_clearance", value: "ai-token", domain: ".missav.ai" },
    { name: "__cf_bm", value: "bot-token", domain: "missav.ai" },
    { name: "_cfuvid", value: "visitor-token", domain: ".missav.ai" },
    { name: "cf_clearance", value: "expired-token", domain: ".missav.ai", expiresDate: new Date(Date.now() - 60_000).toISOString() },
    { name: "missav_session", value: "account-token", domain: ".missav.ai" },
    { name: "cf_clearance", value: "ws-token", domain: ".missav.ws" },
  ]
  const aiCookies = cloudflareCookiesForHost(cookies, "missav.ai")
  const wsCookies = cloudflareCookiesForHost(cookies, "missav.ws")
  assert(aiCookies.length === 3, "Cloudflare Cookie 应按域名筛选、排除过期 Cookie，且不包含账号 Cookie")
  assert(aiCookies.some(cookie => cookie.name === "cf_clearance" && cookie.value === "ai-token"), "应保留当前域名的 Clearance Cookie")
  assert(wsCookies.length === 1 && wsCookies[0].value === "ws-token", "不同站点域名的 Clearance Cookie 不得串用")
  assert(isCloudflareSessionCookie({ name: "__cf_bm" }), "应识别 Cloudflare 辅助 Cookie")
  assert(!isCloudflareSessionCookie({ name: "missav_session" }), "账号登录 Cookie 不得误判为 Cloudflare Cookie")
  assert(cloudflareCookiesForHost(cookies, "not-missav.example").length === 0, "不得向非 MISSAV 域名恢复验证 Cookie")
  Script.exit({ passed: 6, message: "MISSAV Cloudflare session regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
