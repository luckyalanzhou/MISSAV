import { Button, Group, HStack, Image, ProgressView, RoundedRectangle, Text, VStack } from "scripting"
import type { MissAVCollection, MissAVCollectionGroup, MissAVVideoItem } from "../../site/client"
import { ACCENT, CardSurface, MEDIA_RADIUS } from "../design"
import { MediaArtwork } from "./media_cards"

export const HOME_QUICK_COLLECTIONS: Array<{ group: MissAVCollectionGroup; title: string; image: string; collection: MissAVCollection }> = [
  { group: "subtitles", title: "中文字幕", image: "captions.bubble", collection: "chinese-subtitle" },
  { group: "japanese", title: "日本 AV", image: "play.rectangle", collection: "new" },
  { group: "amateur", title: "素人", image: "person", collection: "siro" },
  { group: "uncensored", title: "无码影片", image: "lock.open", collection: "uncensored-leak" },
  { group: "asian", title: "亚洲 AV", image: "film", collection: "madou" },
]

export function HomeSearchEntry(props: { title?: string }) {
  return <HStack spacing={12} padding={16} frame={{ maxWidth: "infinity", minHeight: 56 }} background={<CardSurface />} contentShape="rect" accessibilityLabel={props.title || "搜索番号、女优或作品"}>
    <Image systemName="magnifyingglass" foregroundStyle={ACCENT} />
    <Text font="subheadline" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title || "搜索番号、女优或作品"}</Text>
    <Image systemName="chevron.right" font="caption2" foregroundStyle="tertiaryLabel" />
  </HStack>
}

export function HomeQuickCollectionChip(props: { title: string; image: string }) {
  return <HStack spacing={8} padding={{ horizontal: 3 }} contentShape="capsule" accessibilityLabel={`浏览${props.title}`}>
    <Image systemName={props.image} font="caption" foregroundStyle={ACCENT} />
    <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>{props.title}</Text>
  </HStack>
}

export function ContinueWatchingCard(props: { video: MissAVVideoItem; resumeLabel: string; progressFraction?: number; onOpen: (video: MissAVVideoItem) => void; onRemove: (videoCode: string) => void }) {
  const cardWidth = 232
  const artworkWidth = 220
  const positionMarkWidth = 2
  const positionMarkSpacing = cardWidth - artworkWidth - positionMarkWidth
  const artworkHeight = 124
  const rawProgress = props.progressFraction
  const hasProgress = rawProgress !== undefined && Number.isFinite(rawProgress)
  const fraction = rawProgress === undefined || !Number.isFinite(rawProgress) ? 0 : Math.max(0, Math.min(1, rawProgress))
  const filledMarkHeight = Math.round(artworkHeight * fraction)
  const remainingMarkHeight = artworkHeight - filledMarkHeight
  const videoCode = props.video.videoCode.toUpperCase()
  const titleRemainder = props.video.title.slice(videoCode.length)
  const titleStartsWithCode = props.video.title.slice(0, videoCode.length).toUpperCase() === videoCode
    && (titleRemainder.length === 0 || /^[\s\-:：·]/.test(titleRemainder))
  const displayTitle = titleStartsWithCode ? titleRemainder.replace(/^[\s\-:：·]+/, "") || props.video.title : props.video.title
  const progressLabel = hasProgress ? `已播放 ${Math.round(fraction * 100)}%` : undefined
  return <Button
    action={() => props.onOpen(props.video)}
    buttonStyle="plain"
    frame={{ width: cardWidth }}
    contentShape="rect"
    accessibilityLabel={[props.video.title, props.resumeLabel, progressLabel, "继续播放", "长按可移除记录"].filter(Boolean).join("，")}
    contextMenu={{ menuItems: <Group>
      <Button title="从继续观看中移除" systemImage="trash" role="destructive" action={() => props.onRemove(props.video.videoCode)} />
    </Group> }}
  >
    <VStack spacing={0} alignment="leading" frame={{ width: cardWidth, alignment: "leading" }}>
      <HStack spacing={positionMarkSpacing} alignment="center" frame={{ maxWidth: "infinity", height: artworkHeight }}>
        <VStack spacing={0} frame={{ width: positionMarkWidth, height: artworkHeight }}>
          {remainingMarkHeight > 0 ? <RoundedRectangle cornerRadius={1} fill="tertiarySystemFill" frame={{ width: positionMarkWidth, height: remainingMarkHeight }} /> : undefined}
          {filledMarkHeight > 0 ? <RoundedRectangle cornerRadius={1} fill={ACCENT} frame={{ width: positionMarkWidth, height: filledMarkHeight }} /> : undefined}
        </VStack>
        <MediaArtwork video={props.video} width={artworkWidth} height={artworkHeight} radius={MEDIA_RADIUS} />
      </HStack>
      <VStack spacing={6} alignment="leading" padding={{ top: 9, horizontal: 2 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption2" fontWeight="bold" foregroundStyle={ACCENT} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{videoCode}</Text>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={2} frame={{ maxWidth: "infinity", minHeight: 38, alignment: "leading" }} multilineTextAlignment="leading">{displayTitle}</Text>
        <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Image systemName="play.circle.fill" font="caption" foregroundStyle={ACCENT} />
          <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>{props.resumeLabel}</Text>
        </HStack>
        {props.progressFraction !== undefined && Number.isFinite(props.progressFraction) ? <ProgressView value={props.progressFraction} total={1} progressViewStyle="linear" tint={ACCENT} accessibilityLabel={progressLabel} /> : undefined}
      </VStack>
    </VStack>
  </Button>
}
