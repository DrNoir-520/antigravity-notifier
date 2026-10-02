# Antigravity Push Notifier (反重力消息推送服务)

> 🚀 **超轻量、零依赖、防更新丢失、完全隐蔽运行的 Antigravity 智能手机端推送守护进程。**

---

## 🌟 特性概览

- 🪶 **原生零依赖 (Zero Runtime Dependencies)**: 基于 Node.js 原生 `fetch`、`WebSocket` 与 `http` 构建，无需执行 `npm install` 即可开箱即用。
- 🛡️ **更新免疫 (Update Immunity)**:
  - 服务与配置独立于 Antigravity 安装目录，持久化保存于用户主目录 (`~/.gemini/config/notifier.json`)。
  - Antigravity 客户端日常更新升级**绝不丢失配置、绝不中断开机自启**。
- 👻 **绝对隐蔽执行 (Stealth Execution)**:
  - 基于 Windows 任务计划程序 (`schtasks`) 与 VBScript 纯静默加载器 (`wscript.exe //B run-hidden.vbs` WindowStyle = 0)。
  - 登录系统或启动反重力时，**无任何黑框命令行闪烁、无任务栏图标、无弹窗干扰**。
- 🔋 **超低能耗与资源占用**:
  - 反重力未开启或空闲时处于深度休眠与低频轮询状态，内存占用小于 20MB，CPU 占用 0%。
  - 反重力启动时毫秒级自动挂载监听，关闭后自动回归休眠。
- 📱 **精准格式化三状态通知**:
  - 格式严格遵循：`<会话名称>（<项目名称>）<状态> <HH:mm>`
  - 自动识别当前会话归属项目，智能判断三类核心状态：
    1. **已完成**：AI 任务完整执行收尾并就绪。
    2. **待输入**：AI 触发交互式提问（`ask_question`），等待用户手机或网页端回答。
    3. **待确认**：AI 提出计划方案（`Proceed`），等待用户确认（开启自动审批时智能静默不打扰）。
- 📡 **全通道多渠道推送支持**:
  - **Qmsg 酱**: `qmsg://<QMSG_KEY>`
  - **Bark (iOS)**: `bark://<DEVICE_KEY>` 或 `https://api.day.app/<DEVICE_KEY>/`
  - **ntfy.sh**: `ntfy://<TOPIC>` 或 `https://ntfy.sh/<TOPIC>`
  - **Server 酱**: `sctp://<SENDKEY>` 或 `https://sctapi.ftqq.com/<SENDKEY>.send`
  - **企业微信应用消息**: `wecom://<CORPID>:<AGENTID>:<CORPSECRET>@<TOUSER>`
  - **自定义 Webhook**: `https://your-server.com/webhook`

---

## 📁 目录架构

```text
antigravity-notifier/
├── bin/
│   └── notifier.js          # CLI 命令行管理与守护进程入口
├── scripts/
│   ├── run-hidden.vbs       # 纯静默隐蔽启动脚本 (WindowStyle 0)
│   ├── install-service.ps1  # Windows 计划任务自动化注册脚本
│   └── uninstall-service.ps1# 计划任务一键卸载脚本
├── src/
│   ├── config.js            # 跨更新持久化配置管理器 (~/.gemini/config/notifier.json)
│   ├── gateway.js           # 多通道推送网关与消息格式化引擎
│   ├── monitor.js           # 原生 CDP 调试端口自动发现与 DOM 状态观察器
│   ├── service.js           # 防抖去重生命周期状态机与自动审批抑制器
│   └── index.js             # 模块 SDK 入口导出
├── test/
│   ├── test_all.js          # 核心单元测试集 (格式化/状态机/通道归一化/端口探测)
│   └── test_ascii_comments.js # 代码注释规范合规测试
├── package.json             # 项目元信息与 CLI 配置
└── LICENSE                  # MIT 开源许可证
```

---

## ⚡ 快速上手

### 1. 配置推送地址 / Key

直接执行 CLI 命令设置你的通知渠道（配置会自动保存在 `~/.gemini/config/notifier.json`）：

```bash
# 以 Qmsg 酱为例：
node bin/notifier.js set-push "qmsg://c1b887b5f9ed73ea0fa1704ed29064bf496bdf33"

# 或以 iOS Bark 为例：
node bin/notifier.js set-push "https://api.day.app/YOUR_KEY/"

# 或以 ntfy 为例：
node bin/notifier.js set-push "ntfy://my-antigravity-alerts"
```

### 2. 测试推送通道

立刻发送一条测试通知至你的移动端设备：

```bash
node bin/notifier.js test
```

若终端显示 `✅ Test notification successfully sent! Please check your mobile device.`，说明网络与 Key 正常，手机将即刻收到通知。

### 3. 一键注册开机自启与隐蔽服务

执行安装命令，将守护进程注册为 Windows 任务计划程序中的 `Antigravity_Notifier` 任务：

```bash
node bin/notifier.js install
```

- 该命令会自动注册开机登录启动，并立即在后台静默拉起守护进程。
- 全程通过 VBScript `WindowStyle 0` 启动，**绝不弹出任何命令行黑框**。

---

## 🛠️ 常用 CLI 指令

| 命令 | 说明 |
| :--- | :--- |
| `node bin/notifier.js install` | 一键安装并启动 Windows 任务计划后台守护进程 |
| `node bin/notifier.js uninstall` | 卸载并停止 Windows 任务计划后台守护进程 |
| `node bin/notifier.js status` | 查看当前配置、推送通道及计划任务激活状态 |
| `node bin/notifier.js test [url]` | 测试推送通知通道有效性 |
| `node bin/notifier.js set-push <url>` | 更新推送通道 URL 或 Key |
| `node bin/notifier.js background` | 手动在后台隐蔽拉起守护进程（无需注册计划任务） |
| `node bin/notifier.js start` | 前台运行（带控制台调试输出，适合排错与观察日志） |

---

## 🔒 为什么不会随反重力更新而失效？

1. **配置独立持久化**：
   - 绝大多数在 IDE 安装目录下的插件或魔改脚本，在软件自动更新覆盖时会被全量抹除。
   - `antigravity-notifier` 将核心配置文件存储于系统的用户应用数据目录 `C:\Users\<User>\.gemini\config\notifier.json` 中，该目录受独立保护，更新永不触碰。
2. **进程生命周期解耦**：
   - 服务通过 Windows 任务计划程序（Task Scheduler）作为独立宿主运行，使用本地安装的 Node.js 驱动。
   - 不修改反重力客户端内部核心包或 electron 文件，无论客户端如何更新、热重载或重启，后台守护进程都会平滑检测新实例并自动重新建立 WebSocket 通道。

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
