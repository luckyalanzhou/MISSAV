import { Button, HStack, ProgressView, Text, VStack, useEffect, useObservable, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoDetail, type MissAVVideoItem } from "../client"
import { ACCENT } from "../design"
import { copyMissAVDetailReport, createMissAVDetailTrace, MISSAV_DETAIL_STAGE_LABELS, type MissAVDetailProgress, type MissAVDetailTrace } from "../detail-loading"
import { MissAVPlaybackPreparation } from "../playback-preparation"

// Every list waits for playable detail before changing native navigation state.
// Repeated taps share the visible preparation; another selection cancels its owner.
export function useDetailNavigation() {
  const [selected, setSelected] = useState<{ video: MissAVVideoItem; detail: MissAVVideoDetail; preparation: MissAVPlaybackPreparation; trace: MissAVDetailTrace; navigationID: number } | null>(null)
  const [pending, setPending] = useState<MissAVVideoItem | null>(null)
  const [progress, setProgress] = useState<MissAVDetailProgress | null>(null)
  const [clock, setClock] = useState(Date.now())
  const isPresented = useObservable(false)
  const generation = useRef(0)
  const requestStartedAt = useRef<number | null>(null)
  const request = useRef<{ path: string; scope: MissAVRequestScope; preparation: MissAVPlaybackPreparation; trace: MissAVDetailTrace } | null>(null)
  const latestTrace = useRef<MissAVDetailTrace | null>(null)
  const selectedOwner = useRef<MissAVPlaybackPreparation | null>(null)
  function cancel() {
    ++generation.current
    request.current?.trace.mark("cancelled")
    request.current?.scope.cancel()
    request.current?.preparation.dispose()
    request.current = null
    requestStartedAt.current = null
    setPending(null)
    setProgress(null)
  }
  async function open(video: MissAVVideoItem) {
    if (request.current?.path === video.detailPath) return
    cancel()
    const current = generation.current
    const scope = new MissAVRequestScope()
    const preparation = new MissAVPlaybackPreparation(video)
    const startedAt = Date.now()
    requestStartedAt.current = startedAt
    setClock(startedAt)
    const trace = createMissAVDetailTrace(video.detailPath, value => { if (current === generation.current) setProgress(value) })
    latestTrace.current = trace
    request.current = { path: video.detailPath, scope, preparation, trace }
    setPending(video)
    setProgress(null)
    trace.mark("entered")
    try {
      const detail = await missavClient.getVideo(video, { scope, preferRecent: true, trace })
      if (current !== generation.current || scope.cancelled) return
      if (!detail.sources.length) throw new Error("此作品暂未返回可用播放地址，请重试。")
      trace.mark("ui-update", { sourceCount: detail.sources.length })
      preparation.prepareSource(detail)
      selectedOwner.current?.dispose()
      selectedOwner.current = preparation
      setSelected({ video, detail, preparation, trace, navigationID: current })
      request.current = null
      setPending(null)
      isPresented.setValue(true)
      trace.mark("completed", { sourceCount: detail.sources.length })
    } catch (reason) {
      if (!isMissAVRequestCancelled(reason)) trace.mark("failed")
      preparation.dispose()
      if (current === generation.current && !isMissAVRequestCancelled(reason)) {
        await Dialog.alert({ title: "作品加载失败", message: reason instanceof Error ? reason.message : String(reason) })
      }
    } finally {
      if (current === generation.current) { request.current = null; requestStartedAt.current = null; setPending(null) }
    }
  }
  async function copyDiagnostics(videoCode: string) {
    try {
      await copyMissAVDetailReport(latestTrace.current, videoCode)
      await Dialog.alert({ title: "诊断已复制", message: "已复制当前阶段记录。加载完成后，详情页也可复制包含完整耗时的报告；回到对话粘贴即可发送。" })
    } catch (reason) {
      await Dialog.alert({ title: "复制诊断失败", message: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending?.detailPath])
  useEffect(() => () => { cancel(); selectedOwner.current?.dispose() }, [])
  const elapsedMs = pending && requestStartedAt.current !== null ? Math.max(0, clock - requestStartedAt.current) : progress?.elapsedMs ?? 0
  return { selected, pending, progress, elapsedMs, isPresented, open, cancel, copyDiagnostics }
}

export function DetailPreparationStatus({ navigation }: { navigation: ReturnType<typeof useDetailNavigation> }) {
  if (!navigation.pending) return <VStack />
  return <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 20, bottom: 24 }}>
    <HStack spacing={12} padding={14} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 14 }}>
      <ProgressView tint={ACCENT} />
      <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="subheadline">{`正在准备 ${navigation.pending.videoCode.toUpperCase()}`}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">{`${navigation.progress ? MISSAV_DETAIL_STAGE_LABELS[navigation.progress.stage] : "正在开始请求…"} · ${(navigation.elapsedMs / 1000).toFixed(1)} 秒`}</Text>
      </VStack>
      <Button title="复制" systemImage="doc.on.doc" buttonStyle="plain" action={() => { void navigation.copyDiagnostics(navigation.pending.videoCode) }} />
      <Button title="取消" action={navigation.cancel} />
    </HStack>
  </VStack>
}
