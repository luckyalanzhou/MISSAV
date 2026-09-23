import { Button, Image, NavigationStack, ScrollView, Script, Toolbar, ToolbarItem, VStack, ZStack, useObservable } from "scripting"
import { PAGE_PADDING, PageBackground } from "../design"
import { StateView } from "./components/state_view"
import { SettingsPage } from "./settings"

export function AccessGate(props: { onReady: () => void; onClose?: () => void }) {
  const settingsPresented = useObservable(true)
  const supportsMinimization = Boolean(props.onClose) && Script.supportsMinimization()
  const toolbar = <Toolbar>
    {props.onClose ? <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
      <Button action={props.onClose} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭">
        <Image systemName="xmark" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem> : undefined}
    <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => settingsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" navigationDestination={{ isPresented: settingsPresented, content: <SettingsPage onDomainChanged={() => {}} onAccessReady={props.onReady} accessRequired /> }} accessibilityLabel="设置">
        <Image systemName="gearshape" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
    {supportsMinimization ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
      <Button action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="最小化">
        <Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle="label" />
      </Button>
    </ToolbarItem> : undefined}
  </Toolbar>

  return <NavigationStack><ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="首页" navigationBarTitleDisplayMode="large" toolbar={toolbar}><VStack padding={{ horizontal: PAGE_PADDING, top: 32 }}><StateView title="无法连接" description="请检查网络连接或稍后重试。" kind="offline" systemImage="wifi.exclamationmark" /></VStack></ScrollView></ZStack></NavigationStack>
}
