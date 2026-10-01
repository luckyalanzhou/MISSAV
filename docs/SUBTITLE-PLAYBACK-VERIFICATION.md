# 字幕播放检查

字幕下载并缓存不代表播放器已经显示字幕。需要分别确认文件读取、按视频时间匹配，以及 iPhone 上的原生页面叠层。

## 当前播放器行为

- 视频由 Scripting 的 `AVPlayerView` 播放，画面比例采用原生默认值；脚本不提供自定义比例按钮。
- 播放器直接使用 `AVPlayerView` 自带的原生关闭控件；不额外添加导航栏“完成”或脚本自绘关闭按钮。
- 播放页自动横屏。字幕叠在视频上方，单行居中，固定字号 27 点、距页面底部 25 点；白字带黑色描边，不带黑色背景框。
- 有字幕时每 250 毫秒读取 `AVPlayer.currentTime`，只显示当前时间段匹配到的一句；字幕空档会清空文字。没有字幕时只显示原生播放器。
- 开启脚本字幕时关闭画中画，因为脚本页面叠层无法保证出现在系统画中画窗口；无字幕时保留原生画中画能力。
- 搜索结果里的完整免费 SRT 下载后保存在应用 Documents 下的 `MISSAV Subtitles/<番号>.srt`，并自动关联、启用该番号；不再提供文件挑选、手动导入或替换入口。详情页仅保留开启/关闭字幕动作，不显示“已关联字幕”状态文案。
- Scripting 文档提供 `videoGravity` 的 `resizeAspect`、`resizeAspectFill`、`resize` 显示方式，但没有文档化的原生比例切换按钮；当前采用原生默认 `resizeAspect`。

官方接口：[Scripting AVPlayerView](https://scriptingapp.github.io/zh/guide/Device%20Capabilities/Play%20Video/AVPlayerView)、[可观察数据列表 ForEach](https://scriptingapp.github.io/guide/Views/View%20groupings/ForEach/)、[ZStack 底部对齐](https://scriptingapp.github.io/guide/Views/Layout/ZStack/)、[Text 富文本描边](https://scriptingapp.github.io/guide/Views/Displaying%20text/Quick%20Start/)。

## 本机回归检查说明

`tests/native-player-subtitle-regression.mjs` 使用 Node、Playwright 的 Babel 转换器和模拟的 Scripting API，检查字幕缓存、续播时间匹配、倒退跳转、字幕空档清除、可观察列表更新、字幕固定样式、播放页没有重复自绘关闭按钮、播放进度保存和无字幕时的画中画配置。

该模拟只核对代码接线，不代表 Scripting 真机渲染结果；本次修改未运行此测试，也没有在 iPhone 上验证原生关闭控件是否退出外层模态或字幕像素位置。Scripting 的实际界面仍需在设备上确认。

## iPhone 检查步骤

1. 更新并运行脚本，打开一个已下载字幕且详情页字幕开关已开启的作品。
2. 确认播放器横屏打开，AVPlayerView 只显示它自己的原生关闭控件，没有重复的“完成”按钮；比例采用原生默认行为。
3. 在详情页运行“本地字幕叠层测试”，确认字幕出现在视频下侧，字号约为 27 点，距播放器页面底部约 25 点，文字为白色黑描边且没有底色框。
4. 在详情页按番号下载字幕后，应自动保存到应用内部并关联该番号；正常播放并跳到字幕文件的对白时间时，对白应显示在下侧单行，时间段之间的空档不显示文字。
5. 暂停、前进、倒退并退出后续播，确认字幕始终与当前视频时间匹配，原生进度和播放控制可用。
6. 无字幕播放时确认原生画中画仍可用；带脚本字幕时画中画不可用，这是页面叠层的限制。

若本地测试字幕可见但下载字幕不可见，先核对字幕是否已启用、字幕时间与视频版本是否匹配；若两者都不可见，再检查设备端 Scripting 控制台和播放器页面的实际渲染。
