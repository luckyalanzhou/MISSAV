import { Button, HStack, Image, ProgressView, Text, VStack } from "scripting"
import { ACCENT, CardSurface, glassButtonStyle } from "../design"

type StateKind = "loading" | "error" | "empty" | "offline"
type StatePresentation = "page" | "section" | "row"

export function StateView(props: { title: string; description?: string; loading?: boolean; kind?: StateKind; systemImage?: string; action?: () => void; actionTitle?: string; presentation?: StatePresentation }) {
  const kind = props.loading ? "loading" : (props.kind ?? "empty")
  const presentation = props.presentation ?? "page"
  const icon = props.systemImage ?? (kind === "error" ? "exclamationmark.triangle" : kind === "offline" ? "wifi.exclamationmark" : kind === "loading" ? "hourglass" : "rectangle.stack.badge.play")
  if (presentation === "row") return <HStack spacing={12} alignment="center" padding={14} frame={{ maxWidth: "infinity", minHeight: 60 }} background={<CardSurface />}>
    {kind === "loading" ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName={icon} foregroundStyle={kind === "error" ? "systemRed" : "secondaryLabel"} />}
    <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.title}</Text>{props.description ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3} frame={{ maxWidth: "infinity", alignment: "leading" }} multilineTextAlignment="leading">{props.description}</Text> : undefined}</VStack>
    {props.action ? <Button title={props.actionTitle || "重试"} action={props.action} frame={{ minHeight: 44 }} /> : undefined}
  </HStack>
  return <VStack spacing={14} alignment="center" padding={{ horizontal: 20, vertical: presentation === "page" ? 32 : 24 }} frame={{ maxWidth: "infinity", minHeight: presentation === "page" ? 200 : 140 }} background={<CardSurface />}>
    {kind === "loading" ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : <Image systemName={icon} font={(presentation === "page" ? "largeTitle" : "title2")} foregroundStyle={kind === "error" ? "systemRed" : "tertiaryLabel"} />}
    <Text font={presentation === "page" ? "title3" : "headline"} fontWeight="semibold" multilineTextAlignment="center" frame={{ maxWidth: 340, alignment: "center" }}>{props.title}</Text>
    {props.description ? <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="center" frame={{ maxWidth: 340, alignment: "center" }}>{props.description}</Text> : undefined}
    {props.action ? <Button title={props.actionTitle || "重试"} action={props.action} buttonStyle={glassButtonStyle(true)} buttonBorderShape="capsule" controlSize="regular" tint={ACCENT} frame={{ minHeight: 44 }} /> : undefined}
  </VStack>
}
