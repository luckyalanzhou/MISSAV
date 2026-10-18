# MISSAV for Scripting

适用于 iPhone/iPad Scripting 应用的 MISSAV 浏览与播放脚本。

## 功能

- 栏目浏览、作品搜索与系统播放器播放。
- 播放进度保存与继续观看。
- 简体、繁体中文字幕搜索、下载与自动关联。
- 支持 Scripting Home Tab。

## 使用

1. 在 Scripting 3.2.1 或更新版本中导入并运行本项目。
2. 浏览或搜索作品，进入详情页选择画质播放；字幕可在详情页搜索下载。
3. 如需 Cloudflare 验证，在设置中点击“验证访问线路”完成验证。

Home Tab 入口：`home_screen_default_ui.tsx`。

## 数据存储

浏览记录、播放进度和缓存保存在本机。字幕保存在应用文稿目录的 `MISSAV Subtitles` 文件夹，下载数量不限。

## 许可证

[MIT License](LICENSE)。许可证仅适用于本项目代码，不涵盖第三方网站内容。
