# 字幕播放检查

字幕文件已导入不代表播放器已经显示字幕。需要分别确认字幕文件读取、按视频时间匹配，以及 iPhone 上的原生页面叠层。

## 当前播放器行为

- 视频由 Scripting 的 `AVPlayerView` 播放，画面比例采用原生默认值；脚本不提供自定义比例按钮。
- 播放页放在 `NavigationStack` 中，关闭操作使用原生导航栏 `cancellationAction`（“完成”），不再叠加脚本自绘关闭按钮。
- 播放页自动横屏。字幕叠在视频上方，单行居中，固定字号 27 点、距页面底部 25 点；白字带黑色描边，不带黑色背景框。
- 有字幕时每 250 毫秒读取 `AVPlayer.currentTime`，只显示当前时间段匹配到的一句；字幕空档会清空文字。没有字幕时只显示原生播放器。
- 开启脚本字幕时关闭画中画，因为脚本页面叠层无法保证出现在系统画中画窗口；无字幕时保留原生画中画能力。

官方接口：[Scripting AVPlayerView](https://scriptingapp.github.io/guide/Views/AVPlayerView)、[AVPlayerView 示例与原生导航关闭操作](https://scriptingapp.github.io/zh/guide/Device%20Capabilities/Play%20Video/AVPlayerView)、[可观察数据列表 ForEach](https://scriptingapp.github.io/guide/Views/View%20groupings/ForEach/)、[ZStack 底部对齐](https://scriptingapp.github.io/guide/Views/Layout/ZStack/)、[Text 富文本描边](https://scriptingapp.github.io/guide/Views/Displaying%20text/Quick%20Start/)。

## 本机回归检查说明

`tests/native-player-subtitle-regression.mjs` 使用 Node、Playwright 的 Babel 转换器和模拟的 Scripting API，检查字幕文件导入、续播时间匹配、倒退跳转、字幕空档清除、可观察列表更新、字幕固定样式、原生导航关闭回调、播放进度保存和无字幕时的画中画配置。

该模拟只核对代码接线，不代表 Scripting 真机渲染结果；本次修改未运行此测试，也没有在 iPhone 上验证导航栏外观或字幕像素位置。Scripting 的实际界面仍需在设备上确认。

## iPhone 检查步骤

1. 更新并运行脚本，打开一个已导入字幕且详情页字幕开关已开启的作品。
2. 确认播放器横屏打开，系统原生导航栏提供“完成”关闭操作；画面比例使用原生行为，没有脚本自绘关闭、字幕设置或画面比例按钮。
3. 在详情页运行“本地字幕叠层测试”，确认字幕出现在视频下侧，字号约为 27 点，距播放器页面底部约 25 点，文字为白色黑描边且没有底色框。
4. 正常播放导入的字幕并跳到字幕文件的对白时间；对白应显示在下侧单行，时间段之间的空档不显示文字。
5. 暂停、前进、倒退并退出后续播，确认字幕始终与当前视频时间匹配，原生进度和播放控制可用。
6. 无字幕播放时确认原生画中画仍可用；带脚本字幕时画中画不可用，这是页面叠层的限制。

若本地测试字幕可见但下载字幕不可见，先核对字幕是否已启用、字幕时间与视频版本是否匹配；若两者都不可见，再检查设备端 Scripting 控制台和播放器页面的实际渲染。
