# Antigravity Push Notifier (反重力手机消息推送守护进程)

<p align="center">
  <img src="https://img.shields.io/badge/Antigravity-AI%20IDE-blue?style=for-the-badge&logo=google" alt="Antigravity">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-blue?style=for-the-badge&logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=for-the-badge&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Dependencies-0%20(Zero)-brightgreen?style=for-the-badge" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" alt="MIT License">
  <img src="https://img.shields.io/badge/Status-Stealth%20%26%20Update--Immune-purple?style=for-the-badge" alt="Stealth">
</p>

> 🚀 **Google DeepMind Antigravity / Gemini CLI 专用的超轻量、零依赖、防更新丢失、完全隐蔽运行的手机端即时消息推送守护进程。**
> 
> *An ultra-lightweight, zero-dependency, stealth background push notification daemon for Google Antigravity & Gemini CLI. Delivers instant alerts to your phone via Qmsg, Bark (iOS), ntfy, WeCom, ServerChan, and Webhooks when long-running AI coding tasks finish or require input.*

---

## 🎯 解决什么痛点？(Why this exists)

在使用 **Google Antigravity / Gemini CLI** 进行大型项目重构、TDD 测试驱动开发或耗时很长的复杂任务时，开发者往往需要离开电脑（如休息、吃饭、外出）。但在传统模式下：
1. **无法得知何时完成**：必须频频跑回电脑前查看控制台或编辑器；
2. **卡在交互流程中被动等待**：当 AI 触发问答（`ask_question`）或等待计划确认（`Proceed`）时，若开发者不在电脑旁，整个任务进度就会一直停滞；
3. **传统脚本易随更新报废**：魔改在软件安装目录下的脚本，只要反重力客户端一升级就会被全量覆盖失效；
4. **弹黑框弹窗影响体验**：常规开机自启常伴随终端黑框闪烁，影响日常办公。

**`antigravity-notifier` 为此而生**：
以 **0 外部依赖、<20MB 内存占用、0% 空闲 CPU、Windows 系统级隐蔽驻留、跨版本升级免疫** 的方式，实时监听反重力任务并在手机上优雅弹出精简提醒！

---

## 🔍 搜索关键词与常见提问索引 (Search & AI Prompt Index)

> 为方便开发者及各类 AI 搜索代理（Perplexity, ChatGPT, Claude, Gemini, Copilot）精准索引与检索，以下列出本仓库覆盖的所有核心场景与自然语言查询词：

| 常见搜索提问 (User Intent / Query) | 对应功能与场景 | 关键词 (Keywords) |
| :--- | :--- | :--- |
| **"如何在手机上接收 Antigravity 任务完成通知？"** | 任务执行收尾后毫秒级推送 | `Antigravity 手机通知`, `反重力 消息推送`, `任务完成提醒` |
| **"How to get mobile notifications when Google Antigravity finishes a task?"** | Task lifecycle settling detection | `antigravity push notification`, `mobile alerts`, `task completion` |
| **"Antigravity 怎么配置微信 / 钉钉 / Bark / Qmsg 提醒？"** | 支持多通道标准化协议 (`bark://`, `qmsg://`, `wecom://`) | `Antigravity Bark`, `Antigravity Qmsg`, `Antigravity 微信推送` |
| **"反重力需要用户确认 (Proceed) 或回答问题时怎么在手机提醒？"** | 自动识别 `待输入` 与 `待确认` 状态 | `Antigravity 待确认提醒`, `ask_question 手机通知`, `plan approval` |
| **"如何让反重力推送服务开机自启且完全静默无黑框？"** | VBScript WindowStyle 0 + Windows 计划任务 | `后台静默运行`, `隐藏控制台窗口`, `windows-task-scheduler` |
| **"反重力更新后插件失效怎么办？如何防更新抹除？"** | 独立于应用安装路径，配置存于 `~/.gemini/config/` | `防更新覆盖`, `update-immune`, `持久化配置` |
| **"无需一直开着 Web 界面的反重力后台监控脚本"** | 原生 CDP WebSocket 端口动态自适应发现 | `headless-monitor`, `cdp-observer`, `zero-dependencies` |

---

## 🌟 核心特性 (Features)

- 🪶 **原生零依赖 (Zero Runtime Dependencies)**:
  - 基于 Node.js 原生 `fetch`、`WebSocket` 与 `http` 构建，无需执行 `npm install` 即可开箱即用。
- 🛡️ **更新免疫 (Update Immunity)**:
  - 服务与配置独立于 Antigravity 安装目录，持久化保存于用户主目录 (`~/.gemini/config/notifier.json`)。
  - Antigravity 客户端日常更新升级**绝不丢失配置、绝不中断开机自启**。
- 👻 **绝对隐蔽执行 (Stealth Execution)**:
  - 基于 Windows 任务计划程序 (`schtasks` / `Register-ScheduledTask`) 与 VBScript 纯静默加载器 (`wscript.exe //B run-hidden.vbs` WindowStyle = 0)。
  - 登录系统或启动反重力时，**无任何黑框命令行闪烁、无任务栏图标、无弹窗干扰**。
- 🔋 **超低能耗与资源占用**:
  - 反重力未开启或空闲时处于深度休眠与低频轮询状态，内存占用小于 20MB，CPU 占用 0%。
  - 反重力启动时毫秒级自动挂载监听，关闭后自动回归休眠。
- 📱 **精准格式化三状态通知**:
  - 格式严格遵循：`<会话名称>（<项目名称>）<状态> <HH:mm>`
  - 智能识别当前会话归属项目，准确派发三类核心状态：
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

## 📁 目录架构 (Architecture)

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
│   └── test_ascii_comments.js # 严格 ASCII 规范合规测试
├── package.json             # 项目元信息与 CLI 配置
└── LICENSE                  # MIT 开源许可证
```

---

## ⚡ 快速上手 (Quick Start)

### 1. 配置推送地址 / Key

直接执行 CLI 命令设置你的通知渠道（配置会自动保存在 `~/.gemini/config/notifier.json`）：

```bash
# 以 Qmsg 酱为例：
node bin/notifier.js set-push "qmsg://YOUR_QMSG_KEY"

# 或以 iOS Bark 为例：
node bin/notifier.js set-push "https://api.day.app/YOUR_DEVICE_KEY/"

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

## 🛠️ 常用 CLI 指令汇总 (CLI Reference)

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

## 💡 常见问题 (FAQ)

<details>
<summary><b>Q1: 守护进程会影响电脑性能或玩游戏吗？</b></summary>
完全不会。在反重力未开启或空闲时，进程每隔数秒仅做一次轻量本机端口探测，CPU 占用率恒定为 0%，物理内存占用维持在 15~20MB，比一个普通的记事本进程还要轻量。
</details>

<details>
<summary><b>Q2: 如果我开了自动审批方案 (Turbo / Always Proceed)，还会频繁弹通知吗？</b></summary>
不会。服务内置了自动审批感知器，一旦检测到你启用了自动同意方案，便会自动静默抑制“待确认”提醒，避免无效的通知打扰，只在真正任务完成或等待用户输入时提醒。
</details>

<details>
<summary><b>Q3: 我可以同时在公司电脑和家用电脑上使用吗？</b></summary>
可以。每一台安装了 Antigravity 的电脑都可以独立部署本守护进程，支持使用同一个或不同的推送 Key。
</details>

---

## 📄 开源许可证 (License)

本项目遵循 [MIT License](LICENSE) 开源。欢迎 Star、Fork 与提交 Issue！
