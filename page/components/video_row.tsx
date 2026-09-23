import { Button, Divider, HStack, Image, LazyVStack, Text, VStack } from "scripting"
import type { MissAVVideoItem } from "../../client"
import { ACCESSORY_ALIGNMENT_WIDTH, ACCENT, MEDIA_ROW_HEIGHT, MEDIA_ROW_RADIUS, MEDIA_ROW_WIDTH, ROW_SPACING } from "../../design"
import { MediaArtwork } from "./media_cards"

export function VideoRowList(props: { items: MissAVVideoItem[]; status?: (video: MissAVVideoItem) => string | undefined; statusSystemImage?: string; onOpen: (video: MissAVVideoItem) => void }) {
  return <LazyVStack spacing={ROW_SPACING} frame={{ maxWidth: "infinity" }}>{props.items.map((video, index) => <VStack key={video.videoCode} spacing={0} frame={{ maxWidth: "infinity" }}><VideoRow video={video} status={props.status?.(video)} statusSystemImage={props.statusSystemImage} onOpen={props.onOpen} />{index < props.items.length - 1 ? <Divider /> : undefined}</VStack>)}</LazyVStack>
}

export function VideoRow(props: { video: MissAVVideoItem; status?: string; statusSystemImage?: string; onOpen: (video: MissAVVideoItem) => void }) {
  const metadata = [props.video.videoCode.toUpperCase(), props.video.duration].filter(Boolean).join(" · ")
  return <Button action={() => props.onOpen(props.video)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" accessibilityLabel={[props.video.title, metadata, props.status, "打开详情"].filter(Boolean).join("，")}>
    <HStack spacing={12} alignment="center" padding={{ vertical: 11 }} frame={{ maxWidth: "infinity", minHeight: 86 }}>
      <MediaArtwork video={props.video} width={MEDIA_ROW_WIDTH} height={MEDIA_ROW_HEIGHT} radius={MEDIA_ROW_RADIUS} />
      <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline" fontWeight="semibold" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.video.title}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
        {props.status ? <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName={props.statusSystemImage || "clock.arrow.circlepath"} font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.status}</Text></HStack> : props.video.badge ? <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}><Image systemName="sparkles" font="caption2" foregroundStyle={ACCENT} /><Text font="caption" fontWeight="semibold" lineLimit={1}>{props.video.badge}</Text></HStack> : undefined}
      </VStack>
      <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: ACCESSORY_ALIGNMENT_WIDTH, maxHeight: "infinity", alignment: "center" }} />
    </HStack>
  </Button>
}
