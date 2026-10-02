import { recordMissAVAccessDiagnostic, type MissAVDetailStage } from "./access-diagnostics"

export const MISSAV_DETAIL_STAGE_LABELS: Record<MissAVDetailStage, string> = {
  entered: "进入详情页", "verification-wait": "等待线路验证结束", "cookie-restore": "恢复网站会话",
  "page-load": "加载详情网页", "document-read": "读取详情网页", "source-parse": "提取播放地址",
  "cookie-capture": "保存网站会话", "detail-parse": "整理作品信息", "ui-update": "更新播放按钮",
  completed: "播放信息已载入", timeout: "获取播放信息超时", cancelled: "请求已取消",
  discarded: "旧请求结果已忽略", failed: "详情加载失败", left: "已离开详情页",
}
export type MissAVDetailProgress = { stage: MissAVDetailStage; elapsedMs: number; requestId: number }
let sequence = 0

// Bounded per-request trace, with no raw HTML, account data or media URLs.
export function createMissAVDetailTrace(target: string, onProgress?: (progress: MissAVDetailProgress) => void) {
  const requestId = ++sequence, started = Date.now()
  const entries: MissAVDetailProgress[] = []
  let previous: MissAVDetailStage | undefined
  return {
    mark(stage: MissAVDetailStage, metrics: { documentChars?: number; sourceCount?: number } = {}) {
      if (previous === stage) return
      previous = stage
      const progress = { stage, elapsedMs: Math.max(0, Date.now() - started), requestId }
      entries.push(progress)
      if (entries.length > 24) entries.shift()
      recordMissAVAccessDiagnostic("detail", target, { state: ["timeout", "failed"].includes(stage) ? "load-error" : ["left", "cancelled", "discarded"].includes(stage) ? "cancelled" : "normal", detailStage: stage, ...progress, ...metrics })
      try { onProgress?.(progress) } catch { /* Observers cannot break a request. */ }
    },
    describe() {
      return `请求 ${requestId} · 已经过 ${((Date.now() - started) / 1000).toFixed(1)} 秒\n` + entries.map(entry => `${(entry.elapsedMs / 1000).toFixed(1)} 秒：${MISSAV_DETAIL_STAGE_LABELS[entry.stage]}`).join("\n")
    },
  }
}
export type MissAVDetailTrace = ReturnType<typeof createMissAVDetailTrace>
