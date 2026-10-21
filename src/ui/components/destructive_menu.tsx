import { Button, HStack, Image, Menu, ProgressView, Text } from "scripting"

export function DestructiveMenu(props: {
  title: string
  confirmationTitle?: string
  description: string
  action: () => Promise<void>
  busy?: boolean
}) {
  return <Menu
    label={<HStack spacing={6} padding={{ horizontal: 10, vertical: 8 }} frame={{ minHeight: 44 }} background="secondarySystemBackground" clipShape="capsule" contentShape="capsule" accessibilityLabel={props.busy ? "正在清除记录" : `更多操作：${props.title}。${props.description}`}>
      {props.busy ? <ProgressView progressViewStyle="circular" tint="systemRed" /> : <Image systemName="ellipsis" font="headline" foregroundStyle="secondaryLabel" />}
      <Text font="footnote" fontWeight="semibold" foregroundStyle="secondaryLabel">{props.busy ? "清除中" : "更多"}</Text>
    </HStack>}
    menuIndicator="hidden"
    disabled={props.busy}
    accessibilityLabel={props.busy ? "正在清除记录" : `更多操作：${props.title}。${props.description}`}
  >
    <Button title={props.confirmationTitle || "确认清空"} systemImage="trash.fill" role="destructive" disabled={props.busy} action={() => { void props.action() }} />
    <Button title="取消" systemImage="xmark" role="cancel" action={() => {}} />
  </Menu>
}
