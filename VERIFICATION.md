# 0.1.0 验证记录

日期：2026-10-11，Asia/Shanghai。原生环境：HarmonyOS aarch64，Node 24.21.0-ohos.1；设备调试通道报告 HarmonyOS 7.0.0，系统浏览器包 `com.huawei.hmos.browser`，版本 `6.1.8.301`。浏览器实际连接声明 Chromium `144.0.0.0`、ArkWeb `7.0.0.105`。DSH runtime `0.2.0-rc.2`，当前 web profile。

## 已通过

- `npm run check`：全部项目 JavaScript 语法、JSON 和 Manifest V3 关键声明。
- `npm test`：17 项测试全部通过。真实 WebSocket/HTTP 测试覆盖私有凭据持续保存、错误令牌/Origin/空消息拒绝、结果关联、断线不重放、取消和超时、含空格路径、根路径 CSS/JS、越界符号链接拒绝、PNG 保存及禁止覆盖。控制器与 worker/DOM fixture 覆盖离线启动、worker 重建、原生输入协议、取消后不继续按键、接口超时、日志限额、旧引用拒绝、隐藏下拉不修改和 Shadow DOM 可见文字等待。
- 通过官方 `pluginManager/installBundle` 安装到当前 profile。最终启用结果为 `application: applied`、无 warnings；`pluginManager/listPlugins` 确认 `include:oheco-browser-control` 的 `plugin.js` 入口处于 active。
- 实际模型调用 `browser_status`、`browser_open`、`browser_wait`、`browser_snapshot`、`browser_action` 成功。10 个工具已注册到当前会话。
- 用户在 `hwbrowser://extensions` 加载扩展并完成一次配对。配对使用本机终端显示的令牌；后续连接恢复不需重新填写。
- dsh bundle 关闭再开启期间扩展自动重新连接；新 Host 实例连接时间更新，无人工点击连接。
- 关闭所有专门创建的测试标签页、释放调试目标后，`node scripts/idle-test.mjs` 观察 90 秒：连接时间保持相同、心跳持续更新、没有待处理请求。报告为 `$XDG_CACHE_HOME/dsh-browser-control/verification/idle-test.json`。
- `node scripts/native-test.mjs` 在 19:35:04–19:35:09 完成 **12 项原生端到端验收**，通过同一 installed Host 的认证 RPC 调用共享工具实现，目标为专门创建的本地测试页面，结束后关闭该脚本创建的标签页：
  1. 本地页面和以 `/style.css`、`/app.js` 指向的资源正确加载；
  2. 页面快照不包含密码值；
  3. 中文 fill/type、Tab 原生按键、select、checkbox、点击提交及页面结果正确；
  4. 原生悬停与双击事件正确；
  5. 开放 Shadow DOM 点击、可见文字等待、快照文字正确且隐藏文字不泄露；
  6. 第二次快照后的旧 ref 明确返回 `STALE_ELEMENT`；
  7. 视口、整页、禁用元素截图均返回有效 PNG；
  8. 同进程 iframe 上下文、内部滚动后的按钮点击、元素截图成功；
  9. 滚动及屏幕外元素点击成功；
  10. 捕获初始导航的 console error 和 HTTP 404；
  11. 标签页复制、激活、关闭成功；
  12. 导航、前进、后退和刷新成功。
- 原生测试报告保存在 `$XDG_CACHE_HOME/dsh-browser-control/verification/native-test.json`，实际截图保存在该目录同级 `screenshots/`。四张 PNG 分别为 3122×1828、3091×3889、226×78、220×53；DSH 附件服务同时接受并处理这些图片。
- ws 8.21.0 通过指定 SOCKS5 代理从真实 npm 注册中心取得，19 个 vendored 文件均与固定归档逐字节一致，归档摘要见第三方说明。构建与 npm pack 在本机原生 Node 上完成，使用 `--offline`，不下载运行依赖。
- 长期令牌只在应用私有 `$XDG_CONFIG_HOME` 中保存，源码、打包产物和状态输出不含真实令牌。

## 验证边界

当前模型未声明图像输入，验收依据页面结构、事件、状态断言、PNG 尺寸及附件服务处理结果；没有声称对截图进行了视觉质量判定。截图原文件和 GUI 预览可供用户查看。

跨进程 iframe、封闭 Shadow DOM、浏览器内部页、隐私窗口及文件上传下载不在第一版支持范围。没有关闭用户浏览器来强行验证完整浏览器重启；已验证扩展重新加载后保留配置、Host 重载时自动恢复，worker 冷启动逻辑另由 fixture 覆盖。结果仅代表上述设备和浏览器版本。

## 安装中的模块缓存

初次开发目录入口导入 DSH 包依赖失败，已改为不依赖 DSH 包导入的独立 Host entry。已有模块使用相同路径时会被 DSH/Node 缓存；更换为最终 `plugin.js`、`server.js`、`operations.js` 入口后实际加载并完成原生验收。将来升级相同入口的包时，应遵循管理器 `restart-required` 提示重启 dsh；仅见安装成功不能证明新代码生效。

## 接入检查中的凭据输出

只读接入研究中，一条诊断输出意外显示了当前 DSH 的启动令牌；后续只在内存中读取并使用，未再次输出，未写入本插件。应在当前 DSH 启动配置中更换该启动令牌；它与浏览器插件独立生成的配对令牌不是同一个凭据。
