# DSH 鸿蒙浏览器控制

让 dsh 模型直接控制 HarmonyOS PC 系统浏览器：打开网页和本地页面、读页面、填写表单、点击和滚动、截图、检查 JavaScript 与网络错误。浏览器运行时会自动连接和重试，无需逐个标签页点击连接。页面操作结束后空闲 30 秒自动解除调试，下次使用时自动附加；dsh 断开时也释放调试会话。

源码：[oheco/dsh-browser-control](https://github.com/oheco/dsh-browser-control)。目标浏览器为系统浏览器 **6.1.8.301**，DSH **0.2.0-rc.2**。支持范围和实测记录见 [VERIFICATION.md](VERIFICATION.md)。

## 安装：一个 ZIP，分别加载浏览器扩展和 dsh 插件

整个版本只发布一个 ZIP，里面已经包含浏览器扩展、dsh 插件、使用说明及运行依赖，不需要 npm 安装依赖。

1. 打开 [最新 Release](https://github.com/oheco/dsh-browser-control/releases/latest)，下载 `dsh-browser-control-0.1.1.zip` 到系统浏览器的下载目录：

   ```text
   /storage/Users/currentUser/Download/com.huawei.hmos.browser
   ```

2. 在该下载目录中解压 ZIP。这个版本解压后的外层目录是：

   ```text
   /storage/Users/currentUser/Download/com.huawei.hmos.browser/dsh-browser-control-0.1.1
   ```

   该目录包含 `package.json`、`main.js`、`client.mjs` 及 `extension` 子目录。安装后请保留这个目录；通过目录安装的 dsh 可能继续从这里加载文件。

3. 浏览器地址栏打开 **`hwbrowser://extensions`**，启用开发者模式，点击加载解压扩展的入口，选择下列 **`extension` 子目录**：

   ```text
   /storage/Users/currentUser/Download/com.huawei.hmos.browser/dsh-browser-control-0.1.1/extension
   ```

4. 打开 dsh 的插件管理页，选择从本地目录安装，选择解压后的 **外层目录**，启用 `@oheco/dsh-browser-control`：

   ```text
   /storage/Users/currentUser/Download/com.huawei.hmos.browser/dsh-browser-control-0.1.1
   ```

   浏览器和 dsh 选择的目录不同：浏览器选择包含 `manifest.json` 的 `extension`；dsh 选择包含 `package.json` 的外层目录。安装后刷新 dsh 页面；若管理器明确提示必须重启，请先重启 dsh。

5. 在 dsh 插件管理页打开 `@oheco/dsh-browser-control` 的详情。**浏览器配对**面板显示连接地址，令牌默认隐藏；点击“复制地址”和“复制令牌”，或点击“显示令牌”后手动复制。

6. 打开浏览器中“DSH 浏览器控制”扩展的设置页，填入连接地址和令牌，保留自动连接选项，保存。回到 dsh 配对面板点击“刷新状态”，显示“浏览器已连接”即可使用。

这一步配对只需完成一次，令牌会在本机持久化。以后启动浏览器或 dsh 都会自动尝试连接，不需要再复制令牌，也不需要逐个页面连接。浏览器扩展先于 dsh 加载时显示等待或未配置属于正常情况。

## 使用

可以直接对模型说：

> 打开我刚写的本地网页，测试表单，检查控制台错误并保存截图。

常见流程：打开 → 等待加载 → 读取页面快照 → 按元素引用操作 → 检查状态与日志 → 截图 → 关闭自己的测试标签页。

| 工具 | 能力 |
| --- | --- |
| `browser_status` | 连接状态、浏览器版本与能力 |
| `browser_open` | 打开网址、开发服务、本地 HTML 文件或项目目录 |
| `browser_tabs` | 列出、激活、关闭、复制标签页；列出时附带调试状态 |
| `browser_navigate` | 跳转、刷新、前进、后退 |
| `browser_snapshot` | 可见文字、元素引用、表单状态、frame 列表 |
| `browser_action` | 点击、双击、悬停、fill/type、下拉选择、按键、滚动 |
| `browser_screenshot` | 视口、整页及元素 PNG 截图 |
| `browser_wait` | 等待元素、文字、URL 条件 |
| `browser_evaluate` | 执行有界 JavaScript 表达式，返回 JSON |
| `browser_logs` | 已捕获的控制台错误、异常、HTTP 错误和请求失败 |

`fill` 替换输入，`type` 追加；按键支持 `Enter`、`Tab`、`Control+A` 等。元素 ref 属于当前快照与文档，重新快照或导航后应使用新 ref。密码值不进入快照。`>>>` 选择器可穿过开放 Shadow DOM。

本地项目通过独立 loopback HTTP 服务提供，支持 `/assets/...` 资源、含空格路径和自定义 `root`；禁止目录列表和越界符号链接。已有开发服务直接传 `http://127.0.0.1:端口/`。

截图默认保存到 `$XDG_CACHE_HOME/dsh-browser-control/screenshots/`；已有文件不会覆盖。DSH 附件服务可提供 GUI 预览；未声明图像输入的模型可获取路径，但不能进行视觉判断。

## 自动停止调试与限制

- 自动连接保持后台可用，页面调试按需开启。最后一个页面请求完成后空闲 **30 秒**解除该标签页的调试；长时间等待或操作执行期间不会因空闲计时而被中断。下一次页面请求自动重新附加。
- dsh 断线或扩展配置被停用时，取消旧请求，释放空闲目标；正在收尾的请求结束后释放。扩展 worker 重新启动时也清理本扩展继承的调试会话。
- 只读取已保存日志、列出标签页和查看连接状态不会重新开启页面调试。日志只在调试附加期间采集；空闲解除后不能补回期间发生的日志。
- 心跳间隔 20 秒，断线按 1、2、4…30 秒重试，alarm 每分钟兜底。系统休眠和浏览器后台调度可能延迟计时或重连。
- 支持普通网页和同进程 iframe。浏览器内部页、隐私窗口、跨进程 iframe、封闭 Shadow DOM、上传下载不在第一版范围。DevTools 或其他调试器占用目标时可能导致操作失败。
- 断线、取消和超时不会重放命令；操作可能已经生效，应先读取状态再决定重试。网页文字和脚本结果作为测试数据处理。

配对令牌保存在应用私有 `$XDG_CONFIG_HOME/dsh-browser-control/connection.json`，不会进入下载目录、源码或 ZIP。鸿蒙 HOME 的 hmdfs 无法可靠控制文件权限，因此不要迁移该私有配置到下载目录。配对面板仅在用户点击显示或复制时读取令牌，不自动放入状态或模型工具输出。

## 开发与卸载

依赖完整固定在 [tpr/ws](tpr/ws)，来源与摘要见 [THIRD_PARTY.md](THIRD_PARTY.md)。无需下载依赖即可检查和打包：

```zsh
npm run check
npm test
npm run package
```

打包只生成一个包含完整项目的 ZIP，随包提供源文件摘要清单。开发者可运行 `node scripts/native-test.mjs` 验证网页功能，运行调试生命周期验收脚本验证自动释放。报告位于 `$XDG_CACHE_HOME/dsh-browser-control/verification/`。CLI 的 `npm run setup -- --show-token` 仍可用于开发排查，普通安装流程不需要它。

升级时下载新 ZIP、解压到新版本目录，重新选择浏览器扩展目录并从新外层目录安装 dsh；已有本机配对令牌保留。若重新加载的扩展因目录变化获得新 ID，请在设置中重新填入原配对信息。不要覆盖已发布版本的 ZIP。

卸载时在 dsh 插件管理器移除 bundle，并在浏览器扩展管理页移除扩展。私有配对配置默认保留，方便重装；需要彻底解除配对时再删除该私有配置。
