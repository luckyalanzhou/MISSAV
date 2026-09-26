import { Script } from "scripting"
import { accountCookiesOnly, isCurrentMissAVCookie, restoreMissAVAccountState } from "../account"

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const restoredState = (cookies: unknown[], metaState?: string): string => {
  const hasSession = accountCookiesOnly(cookies).length > 0
  return restoreMissAVAccountState(hasSession, metaState)
}

const run = (): void => {
  const cloudflareOnly = [{ name: "cf_clearance", value: "token", domain: ".missav.ai" }]
  const session = [{ name: "missav_session", value: "session", domain: ".missav.ai" }]
  assert(accountCookiesOnly(cloudflareOnly).length === 0, "Cloudflare 验证 Cookie 不得被保存为账号会话")
  assert(restoredState(cloudflareOnly) === "signedOut", "只有验证 Cookie 时不得恢复为已登录")
  assert(restoredState(session, "expired") === "expired", "失效状态必须跨重启恢复")
  assert(restoredState(session, "blocked") === "blocked", "待验证状态必须跨重启恢复")
  assert(restoredState(session, "signedIn") === "signedIn", "有效账号会话应恢复为已登录")
  assert(isCurrentMissAVCookie(session[0], "missav.ai"), "当前线路 Cookie 应可被清理")
  assert(!isCurrentMissAVCookie({ ...session[0], domain: ".missav.ws" }, "missav.ai"), "当前线路退出不得清理另一线路 Cookie")
  Script.exit({ passed: 7, message: "MISSAV account auth regression tests passed" })
}

try { run() } catch (error) { Script.exit({ passed: 0, error: error instanceof Error ? error.message : String(error) }) }
