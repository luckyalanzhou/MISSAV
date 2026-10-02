import { Button, HStack, Image, List, Navigation, Picker, Section, SecureField, Text, VStack, useState } from "scripting"
import { submitMissAVAccess } from "../access"
import { openMissAVSiteVerification } from "../site-verification"
import { ACCENT } from "../design"
import { getMissAVBaseURL, getMissAVDomainLabel, getMissAVLandingURL, MISSAV_DOMAIN_OPTIONS, setMissAVBaseURL, type MissAVBaseURL } from "../domain"

export function SettingsPage(props: { onDomainChanged: () => void; onAccessVerified?: () => void; onAccessReady?: () => void; accessRequired?: boolean }) {
  const dismiss = Navigation.useDismiss()
  const [domain, setDomain] = useState<MissAVBaseURL>(() => getMissAVBaseURL())
  const [customDomain, setCustomDomain] = useState("")
  const [accessBusy, setAccessBusy] = useState(false)
  const [accessMessage, setAccessMessage] = useState<string | null>(null)
  const operationBusy = accessBusy

  function changeDomain(value: string) {
    if (operationBusy) return
    const next = value as MissAVBaseURL
    if (next === domain || !MISSAV_DOMAIN_OPTIONS.some(option => option.value === next)) return
    setMissAVBaseURL(next)
    setDomain(next)
    setAccessMessage(null)
    props.onDomainChanged()
  }

  async function verifySiteAccess() {
    if (operationBusy) return
    setAccessBusy(true)
    setAccessMessage(null)
    try {
      const result = await openMissAVSiteVerification()
      setAccessMessage(result.status === "accessible"
        ? result.challengeCompleted
          ? "Cloudflare 验证完成，已检查栏目可访问。正在复用已载入内容刷新首页和浏览页。"
          : "已检查栏目可访问，本次无需 Cloudflare 验证。正在刷新首页和浏览页。"
        : result.status === "blocked"
          ? `${result.probe.title}栏目被站点拒绝访问，不是待完成的验证。请检查网络或切换访问域名后重试。`
        : result.status === "incomplete"
          ? `${result.probe.title}栏目仍显示 Cloudflare 验证。请在弹出的页面完成验证，页面确认载入作品后会自动关闭。`
          : `${result.probe.title}栏目未返回有效作品列表。请检查网络或切换访问域名后重试。`)
      if (result.status === "accessible") props.onAccessVerified?.()
    } catch (reason) {
      setAccessMessage(reason instanceof Error ? reason.message : "访问线路验证窗口当前无法打开。")
    } finally { setAccessBusy(false) }
  }


  function saveCustomDomain() {
    const ready = submitMissAVAccess(customDomain)
    setCustomDomain("")
    if (ready) props.onAccessReady?.()
    dismiss()
  }

  if (props.accessRequired) return <List listStyle="insetGroup" navigationTitle="设置" navigationBarTitleDisplayMode="large">
    <Section footer={<Text>保存后将重新连接。</Text>}>
      <SecureField title="" value={customDomain} onChanged={setCustomDomain} textContentType="URL" autocorrectionDisabled submitLabel="done" onSubmit={saveCustomDomain} />
      <Button title="保存" systemImage="checkmark" disabled={!customDomain.length} tint={ACCENT} action={saveCustomDomain} />
    </Section>
  </List>

  return <List listStyle="insetGroup" navigationTitle="设置" navigationBarTitleDisplayMode="large">
    <Section header={<Text>访问站点</Text>} footer={<Text>栏目提示需要验证时，请点击“验证访问线路”。如果仍无法访问，可切换域名；更改将应用于浏览、搜索、详情和播放。</Text>}>
      <Picker title="站点域名" value={domain} onChanged={changeDomain} disabled={operationBusy}>
        {MISSAV_DOMAIN_OPTIONS.map(option => <Text key={option.value} tag={option.value}>{option.title}</Text>)}
      </Picker>
      <Button title="在 Safari 中打开" systemImage="safari" tint={ACCENT} action={() => { void Safari.openURL(getMissAVLandingURL(domain)) }} />
      <Button title={accessBusy ? "正在验证访问线路" : "验证访问线路"} systemImage="checkmark.shield" disabled={operationBusy} tint={ACCENT} action={() => { void verifySiteAccess() }} />
      {accessMessage ? <Text font="footnote" foregroundStyle="secondaryLabel">{accessMessage}</Text> : undefined}
    </Section>

    <Section header={<Text>数据与隐私</Text>} footer={<Text>如需清除播放或浏览记录，请前往资料库中的对应分类。</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="iphone" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">仅保存在本机</Text><Text font="subheadline" foregroundStyle="secondaryLabel">本机收藏、浏览记录和播放记录不会上传</Text></VStack></HStack>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="arrow.triangle.2.circlepath" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">播放信息实时更新</Text><Text font="subheadline" foregroundStyle="secondaryLabel">打开播放器前会获取当前可用画质</Text></VStack></HStack>
    </Section>

    <Section header={<Text>关于</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="play.rectangle.fill" foregroundStyle={ACCENT} frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">MISSAV</Text><Text font="subheadline" foregroundStyle="secondaryLabel">版本 1.0.0</Text></VStack></HStack>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="network" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">当前站点</Text><Text font="subheadline" foregroundStyle="secondaryLabel">{getMissAVDomainLabel(domain)}</Text></VStack></HStack>
    </Section>
  </List>
}
