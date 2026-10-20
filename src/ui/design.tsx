import { Button, Color, HStack, Image, Text, VStack, ZStack } from "scripting"

export const ACCENT: Color = "systemPink"
export const PAGE_BACKGROUND: Color = "systemBackground"

// 4.0 geometry: reading content follows a leading axis; controls and page states
// use their own semantic center or trailing axes instead of forcing one alignment.
export const PAGE_PADDING = 18
export const PAGE_TOP_PADDING = 8
export const PAGE_BOTTOM_PADDING = 44
export const SECTION_SPACING = 28
export const SECTION_CONTENT_SPACING = 12
export const INLINE_SPACING = 8
export const ROW_SPACING = 0
export const MIN_HIT_SIZE = 44
export const PRIMARY_ACTION_HEIGHT = 52
export const SECONDARY_ACTION_HEIGHT = 48
export const ROW_MIN_HEIGHT = 58
export const ICON_ALIGNMENT_WIDTH = 28
export const ACCESSORY_ALIGNMENT_WIDTH = 16

export const MEDIA_ROW_RADIUS = 10
export const MEDIA_RADIUS = 14
export const MEDIA_HERO_RADIUS = 18
export const MEDIA_ROW_WIDTH = 112
export const MEDIA_ROW_HEIGHT = 63
export const MEDIA_TILE_WIDTH = 184
export const MEDIA_TILE_HEIGHT = 104

export function PageBackground() {
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={PAGE_BACKGROUND} />
}

export function Badge(props: { title: string; active?: boolean; tint?: Color; systemImage?: string }) {
  const foreground: Color = props.active ? "white" : "secondaryLabel"
  return <HStack spacing={4} padding={{ horizontal: 8, vertical: 4 }} background={props.active ? (props.tint ?? ACCENT) : "tertiarySystemFill"} clipShape={{ type: "rect", cornerRadius: 7, style: "continuous" }}>
    {props.systemImage ? <Image systemName={props.systemImage} font="caption2" foregroundStyle={foreground} /> : undefined}
    <Text font="caption2" fontWeight="semibold" foregroundStyle={foreground} lineLimit={1}>{props.title}</Text>
  </HStack>
}

export function SectionHeading(props: { title: string; subtitle?: string; trailing?: any; level?: "primary" | "secondary" }) {
  return <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity", alignment: "topLeading" }}>
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font={props.level === "primary" ? "title2" : "title3"} fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.title}</Text>
      {props.subtitle ? <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.subtitle}</Text> : undefined}
    </VStack>
    {props.trailing}
  </HStack>
}

export function ActionRow(props: { title: string; subtitle?: string; systemImage: string; action: () => void; accessibilityLabel?: string; navigationDestination?: any }) {
  return <Button action={props.action} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: ROW_MIN_HEIGHT }} contentShape="rect" navigationDestination={props.navigationDestination} accessibilityLabel={props.accessibilityLabel ?? [props.title, props.subtitle].filter(Boolean).join("，")}>
    <HStack spacing={12} alignment="center" padding={{ vertical: 8 }} frame={{ maxWidth: "infinity", minHeight: ROW_MIN_HEIGHT }}>
      <Image systemName={props.systemImage} foregroundStyle={ACCENT} frame={{ width: ICON_ALIGNMENT_WIDTH }} />
      <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="semibold" frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.title}</Text>
        {props.subtitle ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.subtitle}</Text> : undefined}
      </VStack>
      <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: ACCESSORY_ALIGNMENT_WIDTH }} />
    </HStack>
  </Button>
}
