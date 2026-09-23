import { Button, HStack, Image, List, Navigation, Picker, Section, SecureField, Text, TextField, VStack, useObservable, useState } from "scripting"
import { submitMissAVAccess } from "../access"
import { getMissAVAccountSnapshot, loginMissAV, openMissAVSiteVerification, signOutMissAV, verifyMissAVAccount, type MissAVAccountSnapshot } from "../account"
import { ACCENT } from "../design"
import { getMissAVBaseURL, getMissAVDomainLabel, MISSAV_DOMAIN_OPTIONS, setMissAVBaseURL, type MissAVBaseURL } from "../domain"
import { ChangelogPage } from "./changelog"

export function SettingsPage(props: { onDomainChanged: () => void; onAccountChanged?: () => void; onAccessReady?: () => void; accessRequired?: boolean }) {
  const dismiss = Navigation.useDismiss()
  const [domain, setDomain] = useState<MissAVBaseURL>(() => getMissAVBaseURL())
  const [customDomain, setCustomDomain] = useState("")
  const [account, setAccount] = useState<MissAVAccountSnapshot>(() => getMissAVAccountSnapshot())
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState(() => getMissAVAccountSnapshot().accountEmail ?? "")
  const [loginPassword, setLoginPassword] = useState("")
  const changelogPresented = useObservable(false)

  function changeDomain(value: string) {
    const next = value as MissAVBaseURL
    if (next === domain || !MISSAV_DOMAIN_OPTIONS.some(option => option.value === next)) return
    setMissAVBaseURL(next)
    setDomain(next)
    setAccount(getMissAVAccountSnapshot())
    props.onDomainChanged()
  }

  async function loginAccount() {
    const email = loginEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAccountMessage("请输入 MISSAV 注册邮箱，不能填写账号显示名。"); return }
    if (!loginPassword) { setAccountMessage("请输入 MISSAV 密码。"); return }
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      const next = await loginMissAV(email, loginPassword)
      setAccount(next)
      setLoginEmail(next.accountEmail || email)
      setAccountMessage("MISSAV 账号已登录，密码未保存。")
      props.onAccountChanged?.()
    } catch (reason) {
      setAccountMessage(reason instanceof Error ? reason.message : "MISSAV 登录失败，请稍后重试。")
    } finally {
      setLoginPassword("")
      setAccountBusy(false)
    }
  }

  async function verifySiteAccess() {
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      const result = await openMissAVSiteVerification()
      setAccountMessage(result === "accessible" ? "当前所选域名页面可访问，无需 Cloudflare 验证；可以继续操作。" : result === "incomplete" ? "Cloudflare 验证尚未完成，请重新打开验证线路，完成挑战后再关闭窗口。" : "无法确认当前域名页面状态，请检查网络或切换线路后重试。")
    } catch (reason) {
      setAccountMessage(reason instanceof Error ? reason.message : "访问线路验证窗口当前无法打开。")
    } finally { setAccountBusy(false) }
  }

  async function refreshAccount() {
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      const next = await verifyMissAVAccount()
      setAccount(next)
      setAccountMessage(next.state === "signedIn" ? "网站账号已验证。" : next.state === "blocked" ? "当前网络暂时无法验证网站账号。" : "登录已失效，请重新登录。")
    } catch (reason) {
      setAccountMessage(reason instanceof Error ? reason.message : "网站账号暂时无法验证。")
    } finally { setAccountBusy(false) }
  }

  async function logoutAccount() {
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      signOutMissAV()
      setAccount(getMissAVAccountSnapshot())
      setAccountMessage("已退出当前站点账号。")
      props.onAccountChanged?.()
    } catch (reason) {
      setAccountMessage(reason instanceof Error ? reason.message : "网站账号暂时无法退出。")
    } finally { setAccountBusy(false) }
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
    <Section header={<Text>访问站点</Text>} footer={<Text>如果当前站点无法访问，可切换至其他可用域名。更改将应用于浏览、搜索、详情和播放。</Text>}>
      <Picker title="站点域名" value={domain} onChanged={changeDomain}>
        {MISSAV_DOMAIN_OPTIONS.map(option => <Text key={option.value} tag={option.value}>{option.title}</Text>)}
      </Picker>
      <Button title="在 Safari 中打开" systemImage="safari" tint={ACCENT} action={() => { void Safari.openURL(domain) }} />
    </Section>

    <Section header={<Text>网站账号</Text>} footer={<Text>邮箱和密码只用于本次登录请求，不会保存；登录成功后仅将网站会话保存在系统钥匙串中。网站收藏与本机收藏分开显示。</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName={account.state === "signedIn" ? "person.crop.circle.badge.checkmark" : account.state === "expired" ? "person.crop.circle.badge.exclamationmark" : account.state === "blocked" ? "person.crop.circle.badge.questionmark" : "person.crop.circle"} foregroundStyle={account.state === "signedIn" ? "systemGreen" : account.state === "signedOut" ? "secondaryLabel" : "systemOrange"} frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">{account.state === "signedIn" ? "已登录网站账号" : account.state === "expired" ? "登录已失效" : account.state === "blocked" ? "需要完成网站验证" : "未登录网站账号"}</Text><Text font="subheadline" foregroundStyle="secondaryLabel">{account.accountLabel || "用于读取网站收藏"}</Text></VStack></HStack>
      {account.state !== "signedIn" ? <TextField title="注册邮箱" value={loginEmail} onChanged={setLoginEmail} textContentType="username" keyboardType="emailAddress" autocorrectionDisabled submitLabel="next" /> : undefined}
      {account.state !== "signedIn" ? <SecureField title="密码" value={loginPassword} onChanged={setLoginPassword} textContentType="password" submitLabel="go" onSubmit={() => { void loginAccount() }} /> : undefined}
      {account.state !== "signedIn" ? <Button title={accountBusy ? "正在登录" : "登录 MISSAV"} systemImage="person.badge.key" disabled={accountBusy || !loginEmail.trim() || !loginPassword} tint={ACCENT} action={() => { void loginAccount() }} /> : undefined}
      {account.state !== "signedIn" ? <Button title="验证访问线路" systemImage="checkmark.shield" disabled={accountBusy} tint={ACCENT} action={() => { void verifySiteAccess() }} /> : undefined}
      {account.state === "signedIn" ? <Button title="验证当前账号" systemImage="checkmark.shield" disabled={accountBusy} tint={ACCENT} action={() => { void refreshAccount() }} /> : undefined}
      {accountMessage ? <Text font="footnote" foregroundStyle="secondaryLabel">{accountMessage}</Text> : undefined}
      {account.state === "signedIn" ? <Button title="退出网站账号" systemImage="rectangle.portrait.and.arrow.right" role="destructive" disabled={accountBusy} action={() => { void logoutAccount() }} /> : undefined}
    </Section>

    <Section header={<Text>数据与隐私</Text>} footer={<Text>如需清除播放或浏览记录，请前往资料库中的对应分类。</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="iphone" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">仅保存在本机</Text><Text font="subheadline" foregroundStyle="secondaryLabel">本机收藏、浏览记录和播放记录不会上传</Text></VStack></HStack>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="arrow.triangle.2.circlepath" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">播放信息实时更新</Text><Text font="subheadline" foregroundStyle="secondaryLabel">打开播放器前会获取当前可用画质</Text></VStack></HStack>
    </Section>

    <Section header={<Text>关于</Text>}>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="play.rectangle.fill" foregroundStyle={ACCENT} frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">MISSAV</Text><Text font="subheadline" foregroundStyle="secondaryLabel">版本 4.1.0</Text></VStack></HStack>
      <Button action={() => changelogPresented.setValue(true)} buttonStyle="plain" frame={{ maxWidth: "infinity" }} contentShape="rect" navigationDestination={{ isPresented: changelogPresented, content: <ChangelogPage /> }} accessibilityLabel="更新日志，查看 MISSAV 版本历史"><HStack spacing={12} frame={{ maxWidth: "infinity", minHeight: 54 }}><Image systemName="clock.arrow.trianglehead.counterclockwise.rotate.90" foregroundStyle={ACCENT} frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">更新日志</Text><Text font="subheadline" foregroundStyle="secondaryLabel">查看版本 4.1.0 与历史更新</Text></VStack><Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" /></HStack></Button>
      <HStack spacing={12} frame={{ minHeight: 54 }}><Image systemName="network" foregroundStyle="secondaryLabel" frame={{ width: 28 }} /><VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="body" fontWeight="semibold">当前站点</Text><Text font="subheadline" foregroundStyle="secondaryLabel">{getMissAVDomainLabel(domain)}</Text></VStack></HStack>
    </Section>
  </List>
}
