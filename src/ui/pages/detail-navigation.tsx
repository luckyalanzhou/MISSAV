import { useEffect, useObservable, useRef, useState } from "scripting"
import { MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoDetail, type MissAVVideoItem } from "../../site/client"
import { createMissAVDetailTrace, type MissAVDetailTrace } from "../../features/detail/detail-loading"
import { MissAVPlaybackSelection, type MissAVPlaybackPreparation } from "../../features/playback/playback-preparation"
import { detailPrefetch } from "../../features/detail/detail-prefetch"

// Every list waits for playable detail before changing native navigation state.
// Repeated taps share the visible preparation; another selection cancels its owner.
export function useDetailNavigation() {
  const [selected, setSelected] = useState<{ video: MissAVVideoItem; detail: MissAVVideoDetail; preparation: MissAVPlaybackPreparation; trace: MissAVDetailTrace; navigationID: number } | null>(null)
  const [pending, setPending] = useState<MissAVVideoItem | null>(null)
  const isPresented = useObservable(false)
  const generation = useRef(0)
  const request = useRef<{ path: string; scope: MissAVRequestScope; preparation: MissAVPlaybackPreparation; trace: MissAVDetailTrace } | null>(null)
  const selection = useRef(new MissAVPlaybackSelection())
  function cancel() {
    ++generation.current
    request.current?.trace.mark("cancelled")
    request.current?.scope.cancel()
    if (request.current) selection.current.abandon(request.current.preparation)
    request.current = null
    setPending(null)
  }
  async function open(video: MissAVVideoItem) {
    if (request.current?.path === video.detailPath) return
    cancel()
    const current = generation.current
    const scope = new MissAVRequestScope()
    const preparation = selection.current.begin(video)
    const trace = createMissAVDetailTrace(video.detailPath)
    request.current = { path: video.detailPath, scope, preparation, trace }
    setPending(video)
    trace.mark("entered")
    try {
      const detail = await detailPrefetch.load(video, { scope, trace })
      if (current !== generation.current || scope.cancelled) return
      if (!detail.sources.length) throw new Error("此作品暂未返回可用播放地址，请重试。")
      trace.mark("ui-update", { sourceCount: detail.sources.length })
      selection.current.accept(preparation, detail)
      setSelected({ video, detail, preparation, trace, navigationID: current })
      request.current = null
      setPending(null)
      isPresented.setValue(true)
      trace.mark("completed", { sourceCount: detail.sources.length })
    } catch (reason) {
      if (!isMissAVRequestCancelled(reason)) trace.mark("failed")
      selection.current.abandon(preparation)
      if (current === generation.current && !isMissAVRequestCancelled(reason)) {
        await Dialog.alert({ title: "作品加载失败", message: reason instanceof Error ? reason.message : String(reason) })
      }
    } finally {
      if (current === generation.current) { request.current = null; setPending(null) }
    }
  }
  useEffect(() => () => { cancel(); selection.current.dispose() }, [])
  return { selected, pending, isPresented, open, cancel }
}
