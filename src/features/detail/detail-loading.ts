import type { MissAVDetailTrace as DetailTrace } from "../../site/detail-trace"
export { createMissAVDetailTrace, MISSAV_DETAIL_STAGE_LABELS } from "../../site/detail-trace"
export type { MissAVDetailMetrics, MissAVDetailProgress, MissAVDetailTrace } from "../../site/detail-trace"

// The user explicitly requests this copy action; reports contain only a video
// code, elapsed stage timings, and counts, never HTML, cookies, or media URLs.
export async function copyMissAVDetailReport(trace: DetailTrace | null, videoCode: string): Promise<void> {
  if (!trace) throw new Error("还没有可复制的详情加载诊断。")
  await Pasteboard.setItems([{ "public.plain-text": `${videoCode.toUpperCase()}\n${trace.describe()}` }], {
    localOnly: true,
    expirationDate: new Date(Date.now() + 10 * 60 * 1000),
  })
}
