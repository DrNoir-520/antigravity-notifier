# Antigravity Notifier (反重力任务消息推送通知器)

<p align="center">
  <img src="https://img.shields.io/badge/Antigravity-AI%20IDE-blue?style=for-the-badge&logo=google" alt="Antigravity">
  <img src="https://img.shields.io/badge/QQ%20推送-Qmsg%20酱-red?style=for-the-badge&logo=tencentqq" alt="QQ 推送">
  <img src="https://img.shields.io/badge/微信推送-Server酱%20%7C%20企业微信-brightgreen?style=for-the-badge&logo=wechat" alt="微信推送">
  <img src="https://img.shields.io/badge/iOS%20推送-Bark-black?style=for-the-badge&logo=apple" alt="Bark">
  <img src="https://img.shields.io/badge/Android%20%2F%20Linux-ntfy-orange?style=for-the-badge&logo=android" alt="ntfy">
  <img src="https://img.shields.io/badge/Dependencies-0%20(Zero)-brightgreen?style=for-the-badge" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" alt="MIT License">
</p>

> 📢 **核心功能：让 Google Antigravity (反重力 AI IDE) 能够通过 QQ、微信、iOS Bark、ntfy 等常用聊天应用，实时推送任务执行进度与完成情况！**
> 
> 离开电脑外出或休息时，无需人肉守在屏幕前盯梢。AI 任务**已完成**、**待确认方案 (Proceed)**、**待输入交互提问 (ask_question)** 或**已中断**时，你的手机 **QQ、微信或 Bark** 将在第一时间收到精准卡片提醒。

---

## 🚀 核心功能 (Features)

### 1. 常用聊天软件全通道推送 (QQ / 微信 / Bark / ntfy / Webhook)
- 🐧 **QQ 推送**：原生支持 **Qmsg 酱** (`qmsg://<QMSG_KEY>`)，直推你的个人 QQ 或指定 QQ 群，消息秒级送达。
- 💬 **微信推送**：
  - 支持 **Server 酱** (`sctp://<SENDKEY>`)，直接推送到微信服务号。
  - 支持 **企业微信应用消息** (`wecom://<CORPID>:<AGENTID>:<CORPSECRET>@<TOUSER>`)，直达企业微信或绑定的个人微信。
- 🍏 **iPhone / iPad 推送**：原生支持 **Bark (iOS)** (`bark://<DEVICE_KEY>` 或 `https://api.day.app/<DEVICE_KEY>/`)，秒级推送到手机锁屏，支持自定义铃声与分组。
- 🤖 **Android / 跨平台推送**：支持 **ntfy.sh** (`ntfy://<TOPIC>`) 或自建 ntfy 实例。
- 🌐 **自定义 Webhook**：支持钉钉群机器人、飞书机器人、Discord 或任意自建 HTTP POST Webhook 接收端。

### 2. 4 大核心任务状态全周期跟踪
- ✅ **已完成 (Completed)**：AI 任务代码编写完毕、测试通过并收尾就绪时，毫秒级推送通知。
- ❓ **待输入 (Question Pending)**：AI 触发交互式提问（`ask_question`）等待用户回答时推送。
  - ⏱️ **独家防打扰延时机制**：支持设置“提问后若用户在 N 秒内未作答才推送通知”（默认 60 秒）。如果你就在电脑前并直接回答了，系统智能识别并自动取消推送，绝不产生多余打扰！
- 📋 **待确认 (Plan Approval Pending)**：AI 生成执行计划并等待用户点击 `Proceed` 批准时推送（若开启 Turbo 自动审批模式，系统将智能静默不推送）。
- ⏹️ **已中断 (Cancelled)**：用户主动中断执行或任务取消时，准确推送已中断状态。

### 3. 精炼直观的推送消息格式
每条通知严格统一遵循精简格式，信息一目了然：
```text
<会话标题>（<工作区/项目名称>）<任务状态> <HH:mm>
```
*真实推送效果示例*：
- `实现用户鉴权与JWT刷新逻辑（my-project）已完成 14:30`
- `重构数据库连接池与并发锁（shop-backend）待输入 15:02`
- `修复支付网关超时重试机制（billing-service）待确认 16:45`

无论同时开启多少个项目与窗口，一眼就能明确是哪一台电脑、哪一个仓库的什么任务需要你处理。

### 4. 守护级系统特性
- 🪶 **原生零外部依赖 (Zero Dependencies)**：基于 Node.js 原生 API 构建，无任何第三方包依赖，克隆后**无需执行 `npm install`** 即可直接运行。
- 🛡️ **跨版本升级免疫 (Update-Immune)**：配置持久化保存在用户目录 (`~/.gemini/config/notifier.json`)，独立于反重力安装路径，**反重力客户端日常更新升级 100% 绝不丢失配置**。
- 👻 **Windows 隐蔽静默运行 (无黑框闪烁)**：内置 Windows 任务计划程序与 VBScript 纯静默运行器 (`WindowStyle 0`)，开机自启和后台运行**全程无任何控制台黑框、无弹窗、不夺取焦点**。
- 🔋 **0% CPU 占用 & 极小内存**：采用原生 Chrome DevTools Protocol (CDP) 端口自适应发现机制，空闲时处于极低功耗待机，内存占用仅 15~20MB。

---

## ⚡ 30 秒快速上手 (Quick Start)

### 步骤 1：设置你的推送渠道

只需一行命令即可绑定你的聊天应用接收地址：

```bash
# 🐧 QQ 推送 (Qmsg 酱)
node bin/notifier.js set-push "qmsg://YOUR_QMSG_KEY"

# 💬 微信推送 (Server 酱)
node bin/notifier.js set-push "sctp://YOUR_SENDKEY"

# 🍏 iPhone / iOS 推送 (Bark)
node bin/notifier.js set-push "https://api.day.app/YOUR_DEVICE_KEY/"

# 🤖 跨平台推送 (ntfy)
node bin/notifier.js set-push "ntfy://my-antigravity-alerts"
```

### 步骤 2：设置提问无回复延时（可选）

默认在 AI 提问 60 秒内无操作后才推送到手机。可根据喜好自由调整：

```bash
# 设置为 30 秒（或设为 0 表示只要 AI 提问就立刻推送）
node bin/notifier.js set-delay 30
```

### 步骤 3：发送测试消息验证

```bash
node bin/notifier.js test
```
若手机端成功弹出测试提醒，说明网络与配置完全正常！

### 步骤 4：一键注册 Windows 开机自启静默服务

```bash
node bin/notifier.js install
```
注册成功后，守护进程将永久在后台隐蔽随系统启动运行。**全程无任何黑框**，你可以关闭终端，安心让反重力处理代码任务！

---

## 🛠️ CLI 常用指令速查 (CLI Reference)

| 命令行指令 | 功能说明 |
| :--- | :--- |
| `node bin/notifier.js set-push <URL/Key>` | 配置或切换推送渠道（支持 QQ Qmsg / 微信 Server酱 / 企业微信 / Bark / ntfy / Webhook） |
| `node bin/notifier.js set-delay <秒数>` | 设置提问请求后等待多少秒无回复才推送（如 `node bin/notifier.js set-delay 60`） |
| `node bin/notifier.js test [URL]` | 立即发送一条测试通知，验证推送通道是否可用 |
| `node bin/notifier.js install` | 一键将守护进程注册到 Windows 任务计划程序，开机纯隐蔽自启（无黑框） |
| `node bin/notifier.js uninstall` | 从 Windows 任务计划程序注销并停止后台守护进程 |
| `node bin/notifier.js status` | 查看当前配置、推送通道、提问延时设置及计划任务激活状态 |
| `node bin/notifier.js background` | 手动在后台隐蔽拉起守护进程（无需注册计划任务，纯静默运行） |
| `node bin/notifier.js start` | 前台运行（输出实时调试日志，排查排错使用） |

---

## ⚙️ 环境变量与高级配置 (Advanced Config)

除了 CLI 命令外，系统还支持通过系统环境变量或直接编辑配置文件进行配置：

- **配置文件路径**：`~/.gemini/config/notifier.json`
- **系统环境变量支持**：
  - `ANTIGRAVITY_PUSH_URL`：指定推送目标 URL 或协议 Key
  - `ANTIGRAVITY_QUESTION_DELAY_SEC`：指定提问无应答延时秒数

配置文件示例：
```json
{
  "pushUrl": "qmsg://YOUR_QMSG_KEY",
  "questionNotificationDelaySeconds": 60,
  "serviceInstalled": true
}
```

---

## 🔍 搜索关键词与自然语言提问索引 (SEO & AI Discovery Index)

> 为方便开发者及各类 AI 搜索代理（如 Perplexity, ChatGPT, Claude, Gemini, Copilot 等）精准索引与检索，以下列出本仓库覆盖的所有核心功能、应用场景与自然语言搜索词：

| 用户常见搜索意图 (User Query) | 对应核心功能 | 检索关键词 (Keywords) |
| :--- | :--- | :--- |
| **"反重力怎么通过 QQ 推送任务完成通知？"** | Qmsg 酱 QQ 消息直推 | `Antigravity QQ 推送`, `反重力 QQ 通知`, `Qmsg 反重力`, `QQ 任务完成提醒` |
| **"反重力任务完成怎么用微信接收？"** | Server 酱 / 企业微信应用消息推送 | `Antigravity 微信推送`, `反重力 微信通知`, `Server酱 Antigravity`, `企业微信 反重力` |
| **"如何在手机上接收 Antigravity 任务完成提醒？"** | iOS Bark / ntfy 锁屏即时通知 | `Antigravity 手机通知`, `反重力 手机消息`, `Antigravity Bark`, `ntfy 反重力` |
| **"How to get mobile push notifications when Google Antigravity finishes a task?"** | Task settlement push notification | `antigravity push notification`, `antigravity mobile alerts`, `gemini-cli notification` |
| **"反重力提问或等待 Proceed 时怎么推送到手机？"** | `待输入` 与 `待确认` 状态智能感知与防打扰延时 | `Antigravity 待确认`, `ask_question 手机提醒`, `Proceed 推送`, `防打扰延时` |
| **"如何让反重力推送服务开机自启且无命令行黑框？"** | Windows 任务计划 + VBScript 纯静默加载 | `后台静默运行`, `Windows 任务计划`, `无黑框自启`, `WindowStyle 0` |
| **"反重力更新后插件脚本失效怎么办？"** | 独立于应用路径，配置持久化于用户目录 | `防更新覆盖`, `update-immune`, `零依赖守护进程`, `zero-dependency` |

---

## 📁 目录架构 (Architecture)

```text
antigravity-notifier/
├── bin/
│   └── notifier.js          # CLI 命令行管理与守护进程入口 (支持 set-push / set-delay / install)
├── scripts/
│   ├── run-hidden.vbs       # 纯静默隐蔽启动脚本 (WindowStyle 0, 无黑框)
│   ├── install-service.ps1  # Windows 任务计划程序自动化安装脚本
│   └── uninstall-service.ps1# 任务计划一键卸载清理脚本
├── src/
│   ├── config.js            # 跨更新持久化配置管理器 (~/.gemini/config/notifier.json)
│   ├── gateway.js           # 多通道推送网关 (QQ/微信/Bark/ntfy/Webhook 归一化派发)
│   ├── monitor.js           # 原生 CDP 调试端口自适应发现与 DOM 状态观察器
│   ├── service.js           # 四状态生命周期状态机、提问延时防打扰与自动审批抑制器
│   └── index.js             # 模块 SDK 入口导出
├── test/
│   ├── test_all.js          # 核心单元测试集 (格式化/延时状态机/通道归一化/端口探测)
│   └── test_ascii_comments.js # 严格 ASCII 注释规范合规测试
├── package.json             # 项目元信息与 CLI 配置
└── LICENSE                  # MIT 开源许可证
```

---

## 🔒 为什么不会随反重力升级而失效？

1. **配置独立于软件目录**：
   大部分魔改在 IDE 安装目录下的脚本，在客户端自动更新升级时会被全量覆盖抹除。本工具将核心配置保存在 Windows 用户应用数据目录 `~/.gemini/config/notifier.json` 中，更新永远不会触碰。
2. **生命周期完全解耦**：
   本服务由本地 Node.js 驱动，作为系统级独立进程运行。无论 Antigravity 客户端如何重启、热更新或更新版本，后台守护进程都会通过 CDP 本地端口自适应重新挂载监听，完全无需重新安装。

---

## 📄 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 开源。欢迎提 Issue 与 PR，也欢迎 Star ⭐️ 支持！
