import { recordMissAVAccessDiagnostic, type MissAVDetailStage } from "./access-diagnostics"

export const MISSAV_DETAIL_STAGE_LABELS: Record<MissAVDetailStage, string> = {
  entered: "开始获取播放信息", "verification-wait": "等待线路验证结束", "cookie-restore": "恢复网站会话",
  "page-load": "加载详情网页", "document-read": "读取详情网页", "source-parse": "提取播放地址",
  "cookie-capture": "保存网站会话", "detail-parse": "整理作品信息", "ui-update": "更新播放按钮",
  completed: "播放信息已载入", timeout: "获取播放信息超时", cancelled: "请求已取消",
  discarded: "旧请求结果已忽略", failed: "详情加载失败", left: "已离开详情页",
}
export type MissAVDetailMetrics = {
  cookieMs?: number; loadMs?: number; parseMs?: number; parseCount?: number;
  documentChars?: number; sourceCount?: number; cacheHit?: boolean;
}
export type MissAVDetailProgress = { stage: MissAVDetailStage; elapsedMs: number; requestId: number; metrics?: MissAVDetailMetrics }
let sequence = 0

// Bounded per-request trace, with no raw HTML, account data or media URLs.
export function createMissAVDetailTrace(target: string, onProgress?: (progress: MissAVDetailProgress) => void) {
  const requestId = ++sequence, started = Date.now()
  const entries: MissAVDetailProgress[] = []
  const publish = (progress: MissAVDetailProgress) => {
    recordMissAVAccessDiagnostic("detail", target, {
      state: ["timeout", "failed"].includes(progress.stage) ? "load-error" : ["left", "cancelled", "discarded"].includes(progress.stage) ? "cancelled" : "normal",
      detailStage: progress.stage, elapsedMs: progress.elapsedMs, requestId: progress.requestId, ...progress.metrics,
    })
    try { onProgress?.({ ...progress, ...(progress.metrics ? { metrics: { ...progress.metrics } } : {}) }) } catch { /* Observers cannot break a request. */ }
  }
  return {
    mark(stage: MissAVDetailStage, metrics: MissAVDetailMetrics = {}) {
      const previous = entries[entries.length - 1]
      if (previous?.stage === stage) {
        if (Object.keys(metrics).length) {
          const updated = { ...previous, metrics: { ...previous.metrics, ...metrics } }
          entries[entries.length - 1] = updated
          publish(updated)
        }
        return
      }
      const progress: MissAVDetailProgress = { stage, elapsedMs: Math.max(0, Date.now() - started), requestId, ...(Object.keys(metrics).length ? { metrics: { ...metrics } } : {}) }
      entries.push(progress)
      if (entries.length > 24) entries.shift()
      publish(progress)
    },
    annotate(metrics: MissAVDetailMetrics) {
      const previous = entries[entries.length - 1]
      if (!previous || !Object.keys(metrics).length) return
      const updated = { ...previous, metrics: { ...previous.metrics, ...metrics } }
      entries[entries.length - 1] = updated
      publish(updated)
    },
    describe() {
      const terminal = [...entries].reverse().find(entry => ["completed", "timeout", "cancelled", "discarded", "failed", "left"].includes(entry.stage))
      const totalMs = Math.max(0, terminal?.elapsedMs ?? Date.now() - started)
      const details = entries.map((entry, index) => {
        const endMs = entries[index + 1]?.elapsedMs ?? totalMs
        const phaseMs = Math.max(0, endMs - entry.elapsedMs)
        const metrics = entry.metrics
        const measurements = [
          metrics?.cookieMs !== undefined ? `Cookie ${metrics.cookieMs}ms` : "",
          metrics?.loadMs !== undefined ? `网页 ${metrics.loadMs}ms` : "",
          metrics?.parseMs !== undefined ? `解析 ${metrics.parseMs}ms/${metrics.parseCount ?? 0}次` : "",
          metrics?.documentChars !== undefined ? `HTML ${metrics.documentChars}字` : "",
          metrics?.sourceCount !== undefined ? `播放源 ${metrics.sourceCount}` : "",
          metrics?.cacheHit ? "命中详情缓存" : "",
        ].filter(Boolean).join(" · ")
        return `${(entry.elapsedMs / 1000).toFixed(1)} 秒：${MISSAV_DETAIL_STAGE_LABELS[entry.stage]}（阶段 ${phaseMs}ms）${measurements ? `\n  ${measurements}` : ""}`
      }).join("\n")
      return `请求 ${requestId} · 已经过 ${(totalMs / 1000).toFixed(1)} 秒\n${details || "尚无阶段记录。"}`
    },
  }
}
export type MissAVDetailTrace = ReturnType<typeof createMissAVDetailTrace>

// The user explicitly requests this copy action; reports contain only a video
// code, elapsed stage timings, and counts, never HTML, cookies, or media URLs.
export async function copyMissAVDetailReport(trace: MissAVDetailTrace | null, videoCode: string): Promise<void> {
  if (!trace) throw new Error("还没有可复制的详情加载诊断。")
  await Pasteboard.setItems([{ "public.plain-text": `${videoCode.toUpperCase()}\n${trace.describe()}` }], {
    localOnly: true,
    expirationDate: new Date(Date.now() + 10 * 60 * 1000),
  })
}
