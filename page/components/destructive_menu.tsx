import { Button, Divider, HStack, Image, Menu, ProgressView, Text, VStack } from "scripting"

export function DestructiveMenu(props: {
  title: string
  confirmationTitle?: string
  description: string
  action: () => Promise<void>
  busy?: boolean
}) {
  return <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
    <Divider />
    <Menu
      label={<HStack spacing={12} frame={{ maxWidth: "infinity", minHeight: 60 }} padding={{ horizontal: 8, vertical: 6 }} contentShape="rect">
        {props.busy ? <ProgressView progressViewStyle="circular" tint="systemRed" frame={{ width: 28, minHeight: 44, alignment: "center" }} /> : <Image systemName="trash" foregroundStyle="systemRed" frame={{ width: 28, minHeight: 44, alignment: "center" }} />}
        <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="body" fontWeight="semibold" foregroundStyle="systemRed">{props.busy ? "正在清除…" : props.title}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{props.description}</Text>
        </VStack>
        <Image systemName="chevron.up.chevron.down" font="caption2" foregroundStyle="tertiaryLabel" frame={{ width: 24, alignment: "center" }} />
      </HStack>}
      frame={{ maxWidth: "infinity" }}
      menuIndicator="hidden"
      menuStyle="button"
      buttonStyle="plain"
      disabled={props.busy}
      accessibilityLabel={props.busy ? "正在清除记录" : `${props.title}。${props.description}。展开确认菜单`}
    >
      <Button title={props.confirmationTitle || "确认清空"} systemImage="trash.fill" role="destructive" disabled={props.busy} action={() => { void props.action() }} />
      <Button title="取消" systemImage="xmark" role="cancel" action={() => {}} />
    </Menu>
  </VStack>
}
