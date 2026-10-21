import { Button, HStack, Image, ProgressView, Text, VStack } from "scripting"
import type { MissAVCollection, MissAVCollectionGroup, MissAVVideoItem } from "../../site/client"
import { ACCENT, MEDIA_RADIUS } from "../design"
import { MediaArtwork } from "./media_cards"

export const HOME_QUICK_COLLECTIONS: Array<{ group: MissAVCollectionGroup; title: string; image: string; collection: MissAVCollection }> = [
  { group: "subtitles", title: "中文字幕", image: "captions.bubble", collection: "chinese-subtitle" },
  { group: "japanese", title: "日本 AV", image: "play.rectangle", collection: "new" },
  { group: "amateur", title: "素人", image: "person", collection: "siro" },
  { group: "uncensored", title: "无码影片", image: "lock.open", collection: "uncensored-leak" },
  { group: "asian", title: "亚洲 AV", image: "film", collection: "madou" },
]

export function HomeSearchEntry(props: { title?: string }) {
  return <HStack spacing={8} padding={{ horizontal: 6, vertical: 4 }} frame={{ maxWidth: "infinity" }} contentShape="capsule" accessibilityLabel={props.title || "搜索番号、女优或作品"}>
    <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" />
    <Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title || "搜索番号、女优或作品"}</Text>
    <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
  </HStack>
}

export function HomeQuickCollectionChip(props: { title: string; image: string }) {
  return <HStack spacing={8} padding={{ horizontal: 3 }} contentShape="capsule" accessibilityLabel={`浏览${props.title}`}>
    <Image systemName={props.image} font="caption" foregroundStyle="secondaryLabel" />
    <Text font="footnote" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>{props.title}</Text>
  </HStack>
}

export function ContinueWatchingCard(props: { video: MissAVVideoItem; resumeLabel: string; progressFraction?: number; onOpen: (video: MissAVVideoItem) => void }) {
  const cardWidth = 220
  const progressLabel = props.progressFraction !== undefined ? `已播放 ${Math.round(props.progressFraction * 100)}%` : undefined
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ width: cardWidth }} contentShape="rect" accessibilityLabel={[props.video.title, props.resumeLabel, progressLabel, "继续播放"].filter(Boolean).join("，")}>
    <VStack spacing={7} alignment="leading" frame={{ width: cardWidth, alignment: "leading" }}>
      <MediaArtwork video={props.video} width={cardWidth} height={124} radius={MEDIA_RADIUS} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} frame={{ width: cardWidth, minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
      <HStack spacing={5} frame={{ width: cardWidth, alignment: "leading" }}>
        <Image systemName="clock.arrow.circlepath" font="caption2" foregroundStyle={ACCENT} />
        <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel" lineLimit={1}>{props.resumeLabel}</Text>
      </HStack>
      {props.progressFraction !== undefined ? <ProgressView value={props.progressFraction} total={1} progressViewStyle="linear" tint={ACCENT} accessibilityLabel={progressLabel} /> : undefined}
    </VStack>
  </Button>
}
