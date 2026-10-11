# 0.1.1 验证记录

日期：2026-10-11，Asia/Shanghai。原生环境：HarmonyOS aarch64，Node 24.21.0-ohos.1；系统浏览器包 `com.huawei.hmos.browser`、版本 `6.1.8.301`，连接声明 Chromium `144.0.0.0`、ArkWeb `7.0.0.105`。DSH runtime `0.2.0-rc.2`，web profile。

## 自动化检查

`npm run check` 检查项目 JavaScript 语法、JSON 和 Manifest V3。`npm test` 共 25 项：私有凭据持久化、错误凭据与 Origin 拒绝、结果关联、断线不重放、取消和超时、本地资源与越界符号链接、PNG 禁止覆盖、自动重连与 worker 重建、原生输入协议、日志限额、页面 ref 与 Shadow DOM，以及配对令牌不进入状态和模型工具。

调试生命周期回归包括：独立标签页的空闲期限、请求完成后重新计时、缓存日志和标签页查询不附加、长请求保护、断线后清理、原生 detach 与新 attach 串行、关闭标签页清理计时器、worker 继承会话清理，以及不触发 timer 时的 alarm sweep。

## 系统浏览器实测

通过已安装 Host 的认证 RPC 调用共享工具实现，创建专用测试页，结束后关闭自身标签页。`node scripts/native-test.mjs` 的 12 项通过：

1. 本地页面和根路径 CSS/JavaScript 资源加载。
2. 快照省略密码值。
3. 中文 fill/type、Tab、select、checkbox、点击提交与页面结果。
4. 原生悬停与双击。
5. 开放 Shadow DOM 点击、文字等待、隐藏文字省略。
6. 旧快照 ref 返回 `STALE_ELEMENT`。
7. 视口、整页和禁用元素有效 PNG。
8. 同进程 iframe 上下文、内部滚动点击、元素截图。
9. 屏幕外元素滚动与点击。
10. 初始导航 console error 与 HTTP 404 捕获。
11. 标签页复制、激活和关闭。
12. 导航、历史前后与刷新。

`node scripts/detach-native-test.mjs` 使用真实 `chrome.debugger.getTargets` 验证：页面请求附加；保持标签页打开，空闲 32 秒后原生 attached=false；下次 snapshot 自动重新附加；40 秒真实文字等待在 32 秒时仍 attached=true 且 busy；等待完成后再次空闲释放；缓存日志仍可读取且不重新附加。

`node scripts/disconnect-native-test.mjs <DSH-host-pid>` 验证真实断线清理：创建已附加的 about:blank 目标，关闭 dsh bundle，使扩展连接断开；同一凭据的临时验证 bridge 接受自动重连，仅执行只读标签页查询，原生目标已 attached=false。结束时关闭专用标签页与临时 bridge，恢复 dsh bundle。

此前在关闭所有专用测试目标后还观察了 90 秒 WebSocket 空闲：同一连接持续心跳，无待处理请求。没有因解除页面调试而关闭自动连接。

## DSH 配对界面

通过官方插件管理器安装和启用，在当前 `http://127.0.0.1:3080` 刷新后的插件详情页验证：面板存在，地址正确，状态为已连接；初始令牌输入 type=password 且 value 为空；点击显示后为合法 64 位十六进制值，点击隐藏后清空；实际“复制令牌”显示已复制并保持输入隐藏和空值。验证结果只记录布尔值，未将真实令牌写入输出或截图。

受现有 Connection 认证保护的 `/api/oheco-browser-control/pairing`：未登录 POST 为 401，错误 Origin 为 403，合法 Cookie 为 200；返回令牌与私有配置一致，响应 `Cache-Control: no-store`。令牌仅在显示或复制动作时读取。

本版本使用正式 Fetch-route 注册接口，避开当前 DSH 自定义 RPC 注册中的 Cordis shadow 依赖问题。实际模型的 10 个网页工具仍正常使用。安装管理器有时报告 restart-required；本次使用新 Host 入口后实际激活并验证成功，同入口升级仍应遵循管理器重启提示。

## 发行布局与验证边界

发行 ZIP 包含完整 dsh 包、浏览器 extension、测试及 fixture、运行依赖、说明和许可证。`SOURCE-MANIFEST.json` 记录源文件摘要；ZIP 的 SHA-256 在 Release 说明提供。ws 8.21.0 的完整 19 个 vendored 文件与固定 npm 归档一致，来源、下载 URL、摘要和许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)，离线检查和打包不下载运行依赖。

详细原生报告位于本机 `$XDG_CACHE_HOME/dsh-browser-control/verification/`，报告包含环境和状态断言，不包含实际配对令牌。私有长期令牌保存在 `$XDG_CONFIG_HOME`，不打进源码或发行 ZIP。

模型未声明图像输入；截图验证依据 PNG 结构、尺寸及附件处理结果，没有声称视觉质量判断。跨进程 iframe、封闭 Shadow DOM、浏览器内部页、隐私窗口及文件上传下载不在第一版范围。没有关闭用户浏览器强行测试完整重启；已验证扩展重新加载保留配置、Host 断线自动恢复，worker 冷启动另由 fixture 覆盖。结论仅代表上述设备和版本。
