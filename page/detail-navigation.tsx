import { Button, HStack, ProgressView, Text, VStack, useEffect, useObservable, useRef, useState } from "scripting"
import { missavClient, MissAVRequestScope, isMissAVRequestCancelled, type MissAVVideoDetail, type MissAVVideoItem } from "../client"
import { ACCENT } from "../design"

// Every list waits for playable detail before changing native navigation state.
// Repeated taps share the visible preparation; another selection cancels its owner.
export function useDetailNavigation() {
  const [selected, setSelected] = useState<{ video: MissAVVideoItem; detail: MissAVVideoDetail } | null>(null)
  const [pending, setPending] = useState<MissAVVideoItem | null>(null)
  const isPresented = useObservable(false)
  const generation = useRef(0)
  const request = useRef<{ path: string; scope: MissAVRequestScope } | null>(null)
  function cancel() {
    ++generation.current
    request.current?.scope.cancel()
    request.current = null
    setPending(null)
  }
  async function open(video: MissAVVideoItem) {
    if (request.current?.path === video.detailPath) return
    cancel()
    const current = generation.current
    const scope = new MissAVRequestScope()
    request.current = { path: video.detailPath, scope }
    setPending(video)
    try {
      const detail = await missavClient.getVideo(video, { scope, preferRecent: true })
      if (current !== generation.current || scope.cancelled) return
      if (!detail.sources.length) throw new Error("此作品暂未返回可用播放地址，请重试。")
      setSelected({ video, detail })
      request.current = null
      setPending(null)
      isPresented.setValue(true)
    } catch (reason) {
      if (current === generation.current && !isMissAVRequestCancelled(reason)) {
        await Dialog.alert({ title: "作品加载失败", message: reason instanceof Error ? reason.message : String(reason) })
      }
    } finally {
      if (current === generation.current) { request.current = null; setPending(null) }
    }
  }
  useEffect(() => () => cancel(), [])
  return { selected, pending, isPresented, open, cancel }
}

export function DetailPreparationStatus({ navigation }: { navigation: ReturnType<typeof useDetailNavigation> }) {
  if (!navigation.pending) return <VStack />
  return <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ horizontal: 20, bottom: 24 }}>
    <HStack spacing={12} padding={14} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 14 }}>
      <ProgressView tint={ACCENT} />
      <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`正在准备 ${navigation.pending.videoCode.toUpperCase()}`}</Text>
      <Button title="取消" action={navigation.cancel} />
    </HStack>
  </VStack>
}
