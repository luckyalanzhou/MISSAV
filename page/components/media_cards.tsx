import { Button, HStack, Image, LazyHStack, ScrollView, Text, VStack, ZStack } from "scripting"
import type { MissAVVideoItem } from "../../client"
import { ACCENT, MEDIA_HERO_RADIUS, MEDIA_RADIUS, MEDIA_TILE_HEIGHT, MEDIA_TILE_WIDTH, SECTION_CONTENT_SPACING, SectionHeading } from "../../design"

export function MediaArtwork(props: { video: MissAVVideoItem; width?: number; height: number; radius?: number }) {
  const radius = props.radius ?? MEDIA_RADIUS
  return <ZStack frame={{ ...(props.width ? { width: props.width } : { maxWidth: "infinity" }), height: props.height }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: radius, style: "continuous" }}>
    {props.video.coverUrl ? <Image imageUrl={props.video.coverUrl} resizable aspectRatio={{ value: 16 / 9, contentMode: "fill" }} frame={{ ...(props.width ? { width: props.width } : { maxWidth: "infinity" }), height: props.height }} clipped /> : <Image systemName="play.rectangle" font="title2" foregroundStyle="tertiaryLabel" />}
  </ZStack>
}

export function MediaShelf(props: { title: string; subtitle?: string; items: MissAVVideoItem[]; onOpen: (video: MissAVVideoItem) => void; status?: (video: MissAVVideoItem) => string | undefined; emptyDescription?: string; onEmptyAction?: () => void }) {
  return <VStack spacing={SECTION_CONTENT_SPACING} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <SectionHeading title={props.title} subtitle={props.subtitle} />
    {props.items.length ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={12} alignment="top">{props.items.map(video => <MediaTile key={video.videoCode} video={video} status={props.status?.(video)} onOpen={props.onOpen} />)}</LazyHStack></ScrollView> : <HStack spacing={12} padding={{ vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: 54 }}><Image systemName="rectangle.stack" foregroundStyle="tertiaryLabel" /><Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.emptyDescription || "暂无内容"}</Text>{props.onEmptyAction ? <Button title="去浏览" action={props.onEmptyAction} /> : undefined}</HStack>}
  </VStack>
}

export function MediaTile(props: { video: MissAVVideoItem; status?: string; statusSystemImage?: string; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ width: MEDIA_TILE_WIDTH }} contentShape="rect" accessibilityLabel={[props.video.title, metadata, props.status, "打开详情"].filter(Boolean).join("，")}>
    <VStack spacing={7} alignment="leading" frame={{ width: MEDIA_TILE_WIDTH, alignment: "leading" }}>
      <MediaArtwork video={props.video} width={MEDIA_TILE_WIDTH} height={MEDIA_TILE_HEIGHT} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} frame={{ width: MEDIA_TILE_WIDTH, minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ width: MEDIA_TILE_WIDTH, alignment: "leading" }}>{metadata}</Text>
      {props.status ? <HStack spacing={4} frame={{ width: MEDIA_TILE_WIDTH, alignment: "leading" }}><Image systemName={props.statusSystemImage || "clock.arrow.circlepath"} font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.status}</Text></HStack> : props.video.badge ? <HStack spacing={4} frame={{ width: MEDIA_TILE_WIDTH, alignment: "leading" }}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : undefined}
    </VStack>
  </Button>
}

export function MediaShelfCard(props: { video: MissAVVideoItem; status?: string; onOpen: (video: MissAVVideoItem) => void }) { return <MediaTile {...props} /> }

export function MediaGridCard(props: { video: MissAVVideoItem; status?: string; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={[props.video.title, metadata, props.status].filter(Boolean).join("，")}>
    <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <MediaArtwork video={props.video} height={96} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
      {props.video.badge ? <HStack spacing={4}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption2" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : props.status ? <Text font="caption2" fontWeight="semibold" lineLimit={2}>{props.status}</Text> : undefined}
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
