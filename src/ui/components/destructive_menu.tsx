import { Button, HStack, Image, Menu, ProgressView, Text } from "scripting"
import { glassButtonStyle } from "../design"

export function DestructiveMenu(props: {
  title: string
  confirmationTitle?: string
  description: string
  action: () => Promise<void>
  busy?: boolean
}) {
  return <Menu
    buttonStyle={glassButtonStyle()}
    buttonBorderShape="capsule"
    controlSize="small"
    tint="secondarySystemFill"
    frame={{ minHeight: 44 }}
    label={<HStack spacing={6} contentShape="capsule" accessibilityLabel={props.busy ? "正在清除记录" : `更多操作：${props.title}。${props.description}`}>
      {props.busy ? <ProgressView progressViewStyle="circular" tint="systemRed" /> : <Image systemName="trash" font="caption" foregroundStyle="systemRed" />}
      <Text font="footnote" fontWeight="semibold" foregroundStyle="systemRed">{props.busy ? "清除中" : props.title}</Text>
    </HStack>}
    menuIndicator="hidden"
    disabled={props.busy}
    accessibilityLabel={props.busy ? "正在清除记录" : `更多操作：${props.title}。${props.description}`}
  >
    <Button title={props.confirmationTitle || "确认清空"} systemImage="trash.fill" role="destructive" disabled={props.busy} action={() => { void props.action() }} />
    <Button title="取消" systemImage="xmark" role="cancel" action={() => {}} />
  </Menu>
}
