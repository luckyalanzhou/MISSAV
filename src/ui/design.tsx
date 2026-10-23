import { Button, Capsule, Color, Device, HStack, Image, RoundedRectangle, Text, VStack, ZStack, type DynamicShapeStyle } from "scripting"

export const ACCENT: DynamicShapeStyle = { light: "#246BCE", dark: "#70A7FF" }
export const CONTENT_MAX_WIDTH = 1000
export const READING_MAX_WIDTH = 760
export const PAGE_CANVAS: DynamicShapeStyle = { light: "#F4F5F7", dark: "#0D0F13" }
export const SURFACE: DynamicShapeStyle = { light: "#FFFFFF", dark: "#191C22" }
export const SECONDARY_SURFACE: DynamicShapeStyle = { light: "#ECEFF3", dark: "#22262E" }
export const SURFACE_RIM: DynamicShapeStyle = {
  light: "rgba(23,26,32,0.08)",
  dark: "rgba(255,255,255,0.08)",
}
export const CONTROL_RIM: DynamicShapeStyle = {
  light: "rgba(23,26,32,0.12)",
  dark: "rgba(255,255,255,0.10)",
}

// 4.0 geometry: reading content follows a leading axis; controls and page states
// use their own semantic center or trailing axes instead of forcing one alignment.
export const PAGE_PADDING = 18
export const PAGE_TOP_PADDING = 0
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

export function supportsLiquidGlass(): boolean {
  return typeof Device !== "undefined" && Number.parseInt(Device.systemVersion, 10) >= 26
}

export function glassButtonStyle(prominent = false): "glass" | "glassProminent" | "bordered" | "borderedProminent" {
  const glassAvailable = supportsLiquidGlass()
  if (glassAvailable) return prominent ? "glassProminent" : "glass"
  return prominent ? "borderedProminent" : "bordered"
}

export function CapsuleSurface() {
  return <Capsule fill={SECONDARY_SURFACE} stroke={{ shapeStyle: CONTROL_RIM, strokeStyle: { lineWidth: 1 } }} />
}

export function CardSurface() {
  return <RoundedRectangle cornerRadius={18} fill={SURFACE} stroke={{ shapeStyle: SURFACE_RIM, strokeStyle: { lineWidth: 1 } }} />
}

export function PageBackground() {
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background={PAGE_CANVAS} ignoresSafeArea={true} />
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
