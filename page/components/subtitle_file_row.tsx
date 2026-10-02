import { Button, HStack, Image, ProgressView, Text, VStack } from "scripting"
import { ACCENT, MIN_HIT_SIZE } from "../../design"
import type { SubtitleCatSubtitleFile } from "../../subtitlecat"

type SubtitleFile = SubtitleCatSubtitleFile

export function SubtitleFileRow(props: {
  file: SubtitleFile
  downloadingId: string | null
  onDownload: (file: SubtitleFile) => void
}) {
  const { file, downloadingId } = props
  const canDownload = file.isFree && !file.isDemo
  const downloading = downloadingId === `${file.source}:${file.id}`
  const metadata = [file.source, canDownload ? "完整 · 免费" : "预览", file.details].filter(Boolean).join(" · ")

  return <HStack spacing={8} alignment="center" padding={{ vertical: 4 }} frame={{ maxWidth: "infinity", minHeight: MIN_HIT_SIZE }}>
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="subheadline" fontWeight="semibold" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{file.language}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} accessibilityLabel={metadata} frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata}</Text>
    </VStack>
    <Button action={() => { if (canDownload && !downloadingId) props.onDownload(file) }} disabled={!canDownload || Boolean(downloadingId)} buttonStyle={canDownload ? "borderedProminent" : "bordered"} tint={ACCENT} frame={{ minWidth: 108, minHeight: MIN_HIT_SIZE }} contentShape="rect" accessibilityLabel={canDownload ? `下载${file.source}的${file.language}字幕` : `${file.language}字幕仅供预览，无法下载`}>
      <HStack spacing={4}>
        {downloading ? <ProgressView progressViewStyle="circular" tint="white" /> : <Image systemName={canDownload ? "square.and.arrow.down" : "eye"} font="caption" />}
        <Text font="caption" fontWeight="semibold" lineLimit={1}>{downloading ? "下载中…" : canDownload ? "下载字幕" : "仅供预览"}</Text>
      </HStack>
    </Button>
  </HStack>
}
