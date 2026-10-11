# DSH 鸿蒙浏览器控制

独立 dsh Host bundle + Manifest V3 浏览器扩展。浏览器启动后自动连接，dsh 尚未启动时持续重试，断线后自动恢复。模型可以直接创建和操作普通标签页，无需逐个页面点击连接。

开发目标：HarmonyOS PC 系统浏览器 6.1.8.301，DSH 0.2.0-rc.2。实际兼容性和验证边界见 `VERIFICATION.md`。

## 安装

1. 在 dsh 的插件管理页安装本项目目录或打包的 npm `.tgz`，启用“鸿蒙浏览器控制”。新插件能否立即生效以管理器的 `application` 结果为准。
2. 浏览器地址栏打开 **`hwbrowser://extensions`**。启用开发者模式，使用加载解压扩展的入口选择 `extension/` 目录；如浏览器提供 ZIP 安装入口，可使用交付的扩展 ZIP。入口名称以本机界面为准。
3. 在本项目目录的本机终端执行：

   ```zsh
   npm run setup -- --show-token
   ```

   打开扩展设置，填入输出的本机连接地址和令牌，保存一次。令牌保存在浏览器私有扩展存储中；以后自动连接，不需要再次点击或复制。
4. 在 dsh 中调用 `browser_status` 或执行 `/browser` 检查连接。尚未启动浏览器或 dsh 时扩展会继续自动重试。

官方 CLI 同样支持本地离线安装：

```zsh
HTTPS_PROXY=socks5://127.0.0.1:10808 HTTP_PROXY=socks5://127.0.0.1:10808 dsh plugin --profile web add --offline /absolute/path/oheco-dsh-browser-control-0.1.0.tgz
```

无需安装 Playwright、启动带远程调试参数的浏览器、配置 Native Messaging 或替换 dsh GUI。Host 监听独立的 `127.0.0.1:9227`，与 dsh GUI 端口无关。

## 使用

可以直接对模型说：

> 打开这个本地 HTML 页面，填写表单并提交，检查成功提示和控制台错误，保存截图。

常见流程：

1. `browser_open` 传 `url` 或绝对 `path`，得到 `id`。
2. `browser_wait` 等待页面元素出现。
3. `browser_snapshot` 读取页面，得到元素 `ref`。
4. `browser_action` 按 `tabId` 和 `ref` 点击、输入等。
5. 再次读取页面或使用 `browser_evaluate` 检查预期状态，调用 `browser_logs` 查看错误。
6. `browser_screenshot` 保存截图，结束时用 `browser_tabs` 关闭自己的测试标签页。

| 工具 | 能力 |
| --- | --- |
| `browser_status` | 连接、浏览器能力和待处理请求数 |
| `browser_open` | 新建网址、本机开发服务、本地 HTML 文件或目录页面 |
| `browser_tabs` | 列出、激活、关闭、复制标签页 |
| `browser_navigate` | 跳转、刷新、前进、后退 |
| `browser_snapshot` | 可见文字、元素引用、表单状态、frame 列表 |
| `browser_action` | 点击、双击、悬停、填入、追加输入、下拉选择、按键、滚动 |
| `browser_screenshot` | 视口、整页、元素 PNG 截图 |
| `browser_wait` | 等待元素、文字、URL 条件；超时明确失败 |
| `browser_evaluate` | 执行有界 JavaScript 表达式，返回 JSON，用于检查和测试 |
| `browser_logs` | 测试期间的控制台错误、异常、HTTP 错误和请求失败 |

`fill` 替换原输入，`type` 追加输入，`press` 接受 `Enter`、`Tab`、`Control+A` 等。元素引用属于特定页面快照；重新读取快照、导航或元素移除后，旧引用不可继续使用。密码框的值不会进入快照。CSS selector 使用 `>>>` 可穿过开放 Shadow DOM。

本地项目通过独立的 loopback 静态服务提供，支持 `/assets/...` 等从项目根开始的资源路径。`root` 可指定资源根目录，支持含空格路径及 CSS/JS/图片等资源；不列出目录，不允许路径或符号链接越过项目根。每个项目根复用一个端口，插件卸载时关闭服务。直接 `file://` 访问需要浏览器允许扩展访问文件网址。已有开发服务直接传 `http://127.0.0.1:端口/`。

截图默认保存到 `$XDG_CACHE_HOME/dsh-browser-control/screenshots/`；`path` 可指定绝对的新文件路径，已有文件不覆盖。DSH 有附件服务时同时返回图片；不支持图片输入的模型仍可获取截图路径，但不能进行视觉判断。

## 连接与限制

- 扩展后台使用 WebSocket 每 20 秒心跳，断线按 1、2、4…30 秒快速重试，并通过 `chrome.alarms` 每分钟唤醒兜底。浏览器休眠、系统休眠和后台调度可能延迟重连，不保证固定秒数。
- Chrome 116+ 的 WebSocket 生命周期行为是 Manifest V3 的基线，需要在鸿蒙浏览器上实测。浏览器产品版本不同于 Chromium 版本。
- `chrome.debugger` 是可靠页面控制的必需能力；缺失时会明确报错，不会用不等价的 DOM 点击伪装完成。浏览器可能显示调试提示；DevTools 或其他调试扩展占用目标时可能中断连接。
- 标签页自动附加调试，不需人工连接。浏览器内部设置页及隐私窗口不受控制；普通网页可操作已有页面和新页面。
- 同进程 iframe 可按 `frameId` 指定上下文；跨进程 iframe、封闭 Shadow DOM、文件上传下载和录制回放尚未纳入第一版验收。日志从首次控制标签页开始，不能恢复之前的事件。
- 同一标签页的命令排队执行。连接断开、取消和超时不会重放命令；操作可能已经生效，应先读取状态再决定是否重试。
- 页面文字和脚本结果属于不可信网页内容，应作为测试数据处理。
- 配对令牌验证、扩展 Origin 验证和 loopback Host 检查均开启。一次只接入一个浏览器连接。

长期令牌配置位于 `$XDG_CONFIG_HOME/dsh-browser-control/connection.json`，目录 0700、文件 0600。鸿蒙 HOME 的 hmdfs 无法可靠控制权限，不能将此配置移到 HOME。修改端口时同步修改私有配置和扩展设置，然后重启插件。插件配置中的 `extensionId` 可限制具体扩展 ID。

## 开发和验证

所有运行逻辑为 JavaScript，第三方 ws 8.21.0 完整分发源码固定在 `tpr/ws/`，保留许可证；无需下载依赖即可运行：

```zsh
npm run check
npm test
```

Host 通过原生工具定义注册 API 接入，无需导入 DSH 内部包。独立调试桥接可执行 `npm run serve`，正式使用时由 dsh 插件管理生命周期；两者不能同时占用同一端口。测试临时目录位于 `$TMPDIR`，结束后清理。

首次加载并配对扩展后，可以执行 `node scripts/native-test.mjs` 运行真实浏览器验收，执行 `node scripts/idle-test.mjs` 验证 90 秒空闲连接。报告保存在 `$XDG_CACHE_HOME/dsh-browser-control/verification/`。

`node scripts/package.mjs` 在应用缓存目录创建完整的离线安装包、扩展 ZIP 和 `SHA256SUMS`。第三方来源及固定摘要见第三方说明。升级时以插件管理器的 `restart-required` 提示为准；相同路径的已加载模块可能缓存，需重启 dsh 后才能确认新版本生效。

卸载：在 dsh 插件管理器移除 bundle，在浏览器扩展管理页移除扩展。源码和打包产物不含令牌。私有配置不会随卸载删除，以便重新安装保留配对；需要解除配对时在本机删除该私有配置，并重新安装或更新扩展配置。
