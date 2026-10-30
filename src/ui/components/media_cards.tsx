import { Button, HStack, Image, LazyHStack, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useRef } from "scripting"
import type { MissAVVideoItem } from "../../site/client"
import { detailPrefetch } from "../../features/detail/detail-prefetch"
import { ACCENT, CardSurface, MEDIA_HERO_RADIUS, MEDIA_RADIUS, MEDIA_TILE_HEIGHT, MEDIA_TILE_WIDTH, SECTION_CONTENT_SPACING, SectionHeading } from "../design"

export function MediaArtwork(props: { video: MissAVVideoItem; width?: number; height?: number; radius?: number; prefetch?: boolean }) {
  const radius = props.radius ?? MEDIA_RADIUS
  const key = props.video.videoCode.toLowerCase()
  const frame = props.width ? { width: props.width, ...(props.height !== undefined ? { height: props.height } : {}) } : { maxWidth: "infinity" as const, ...(props.height !== undefined ? { height: props.height } : {}) }
  const subscription = useRef<(() => void) | null>(null)
  const visible = useRef(false)
  const stopPrefetch = () => { subscription.current?.(); subscription.current = null }
  const startPrefetch = () => {
    if (props.prefetch === false || subscription.current) return
    subscription.current = detailPrefetch.watch(props.video)
  }
  useEffect(() => {
    if (visible.current) startPrefetch()
    return stopPrefetch
  }, [key, props.prefetch])
  return <ZStack frame={frame} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: radius, style: "continuous" }}
    onAppear={() => { visible.current = true; startPrefetch() }} onDisappear={() => { visible.current = false; stopPrefetch() }}>
    {props.video.coverUrl ? <Image imageUrl={props.video.coverUrl} resizable aspectRatio={{ value: 16 / 9, contentMode: "fill" }} frame={frame} clipped /> : <Image systemName="play.rectangle" font="title2" foregroundStyle="tertiaryLabel" />}
  </ZStack>
}

export function MediaShelf(props: { title: string; subtitle?: string; items: MissAVVideoItem[]; onOpen: (video: MissAVVideoItem) => void; status?: (video: MissAVVideoItem) => string | undefined; emptyDescription?: string; onEmptyAction?: () => void }) {
  return <VStack spacing={SECTION_CONTENT_SPACING} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <SectionHeading title={props.title} subtitle={props.subtitle} />
    {props.items.length ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={12} alignment="top">{props.items.map(video => <MediaTile key={video.videoCode} video={video} status={props.status?.(video)} onOpen={props.onOpen} />)}</LazyHStack></ScrollView> : <HStack spacing={12} padding={{ vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 54 }}><Image systemName="rectangle.stack" foregroundStyle="tertiaryLabel" /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.emptyDescription || "暂无内容"}</Text>{props.onEmptyAction ? <Button title="去浏览" action={props.onEmptyAction} /> : undefined}</HStack>}
  </VStack>
}

export function MediaTile(props: { video: MissAVVideoItem; status?: string; statusSystemImage?: string; progressFraction?: number; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  const progressLabel = props.progressFraction !== undefined ? `已播放 ${Math.round(props.progressFraction * 100)}%` : undefined
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ width: MEDIA_TILE_WIDTH }} contentShape="rect" accessibilityLabel={[props.video.title, metadata, props.status, progressLabel, "打开详情"].filter(Boolean).join("，")}>
    <VStack spacing={0} alignment="leading" frame={{ width: MEDIA_TILE_WIDTH, alignment: "leading" }} background={<CardSurface />}>
      <MediaArtwork video={props.video} width={MEDIA_TILE_WIDTH} height={MEDIA_TILE_HEIGHT} />
      <VStack spacing={6} alignment="leading" padding={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={2} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
      {props.status ? <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName={props.statusSystemImage || "clock.arrow.circlepath"} font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.status}</Text></HStack> : props.video.badge ? <HStack spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : undefined}
      {props.progressFraction !== undefined ? <ProgressView value={props.progressFraction} total={1} progressViewStyle="linear" tint={ACCENT} accessibilityLabel={progressLabel} /> : undefined}
      </VStack>
    </VStack>
  </Button>
}

export function MediaShelfCard(props: { video: MissAVVideoItem; status?: string; onOpen: (video: MissAVVideoItem) => void }) { return <MediaTile {...props} /> }

export function MediaGridCard(props: { video: MissAVVideoItem; status?: string; statusSystemImage?: string; responsiveArtwork?: boolean; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={[props.video.title, metadata, props.status].filter(Boolean).join("，")}>
    <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }} background={<CardSurface />}>
      <MediaArtwork video={props.video} height={props.responsiveArtwork ? undefined : 96} />
      <VStack spacing={6} alignment="leading" padding={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={2} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
      {props.status ? <HStack spacing={4} alignment="top"><Image systemName={props.statusSystemImage || "info.circle"} font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.status}</Text></HStack> : props.video.badge ? <HStack spacing={4}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : undefined}
      </VStack>
    </VStack>
  </Button>
}

export function MediaHero(props: { video: MissAVVideoItem; eyebrow?: string; description?: string; onOpen: (video: MissAVVideoItem) => void }) {
  return <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={[props.eyebrow, props.video.title, props.description, "打开详情"].filter(Boolean).join("，")}><MediaArtwork video={props.video} height={196} radius={MEDIA_HERO_RADIUS} /></Button>
    {props.eyebrow ? <Text font="caption" fontWeight="bold" foregroundStyle={ACCENT} frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.eyebrow}</Text> : undefined}
    <Text font="title3" fontWeight="bold" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
    {props.description ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.description}</Text> : undefined}
  </VStack>
}
