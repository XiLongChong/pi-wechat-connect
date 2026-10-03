# Pi WeChat Connect

用于 Pi 的微信扩展，支持扫码登录、会话绑定，以及文字、图片和文件收发。

## 环境要求

- Node.js >= 22.19.0。
- Pi CLI 1.x，已配置可用模型。当前适配和验证版本为 1.0.0。
- 支持二维码显示的交互终端。

## 安装

```sh
pi install git:github.com/XiLongChong/pi-wechat-connect@v0.1.0
```

安装后重新启动 Pi；如果 Pi 已在运行，可执行 `/reload`。

## 快速开始

启动 Pi：

```sh
pi --tui-mode regular
```

在 Pi 中执行：

```text
/weixin-login
```

使用手机微信扫描终端二维码并确认。如果手机提示配对码，在终端输入数字并按 Enter。Esc 可取消本次登录。

登录成功后自动绑定当前 Pi 会话。在手机微信中给机器人发送一条消息，Pi 会接收并处理。首次主动发送前，请先从手机发送消息，以建立微信回复上下文。

微信回复通过 `wechat_send_message` 工具发送。普通助手输出仅显示在终端，不会自动转发到微信。

## 命令

| 命令 | 用途 |
|---|---|
| `/weixin-login` | 扫码登录并绑定当前会话；已授权时直接绑定 |
| `/weixin-bind` | 使用已有授权绑定当前会话 |
| `/weixin-status` | 查看授权、绑定和接收状态 |
| `/weixin-reconnect` | 重新建立绑定会话的接收连接 |
| `/weixin-unbind` | 停止接收并解除绑定，保留授权 |
| `/weixin-disconnect` | 停止连接并删除本地授权 |

恢复之前的 Pi 会话：

```sh
pi --tui-mode regular --continue
```

恢复原绑定会话时会自动恢复接收。切换到其他会话后，执行 `/weixin-bind` 重新绑定。Pi 忙碌时，微信消息进入原生 followUp 队列；退出 Pi 后停止接收。

## 发送工具

`wechat_send_message` 支持以下参数。示例为工具参数，不是终端命令：

```json
{ "type": "text", "text": "处理完成。" }
```

```json
{ "type": "image", "path": "C:/work/output/chart.png" }
```

```json
{ "type": "file", "path": "C:/work/output/report.pdf" }
```

图片和文件必须使用本地真实文件的绝对路径。接收人由当前绑定确定。每次调用对应一条微信消息。

## 数据存储

默认数据目录为 `<Pi agentDir>/pi-wechat-connect/`。未自定义 Pi 目录时，通常是 `~/.pi/agent/pi-wechat-connect/`。

授权、绑定、轮询游标和回复上下文保存在该目录；收到的附件保存在其 `attachments/` 下。

可以通过 `PI_WECHAT_STATE_DIR` 指定其他绝对路径。例如 PowerShell：

```powershell
$env:PI_WECHAT_STATE_DIR = 'D:\pi-wechat-data'
pi --tui-mode regular
```

从已有本地实验版本迁移时，可以将该变量指向原来的 `.pi/weixin` 目录。迁移前退出旧 Pi 进程，避免两个进程同时使用一个微信账号。

授权文件是未加密 JSON，请勿分享或提交数据目录。执行 `/weixin-disconnect` 不会删除已接收附件。

## 当前范围

- 仅处理授权者私聊的文字、图片和文件；不支持群聊、语音和视频。
- 一个微信账号绑定一个 Pi 会话；请只运行一个使用该账号的 Pi 进程。
- 登录需要交互终端，消息接收需要 Pi 持续运行。
- 附件解析依赖 Pi 当前可用的工具；扩展不安装 OCR 或 Office 解析环境。
- 发送超时表示结果未确认，扩展不会自动重发。
- 本版本主要在 Windows 环境整理和验证；其他平台尚未完成实际扫码收发验收。

## 排查

- **二维码显示不完整**：扩大终端窗口或缩小字号，按界面提示保留足够尺寸。
- **已登录但没有收消息**：使用 `/weixin-status` 检查状态，必要时执行 `/weixin-bind` 或 `/weixin-reconnect`。
- **授权过期**：执行 `/weixin-disconnect` 后重新 `/weixin-login`。
- **工具没有发送回复**：确认当前会话已绑定，且模型可调用 `wechat_send_message`。

## 开发

```sh
git clone https://github.com/XiLongChong/pi-wechat-connect.git
cd pi-wechat-connect
npm ci
npm test
```

本地测试覆盖二维码输出、登录交互、会话适配和数据路径。真实手机扫码及收发仍需在实际微信环境中验收。

## 依赖与许可

微信连接使用第三方 SDK [@wechatbot/wechatbot](https://github.com/corespeed-io/wechatbot)，二维码由 [qrcode](https://github.com/soldair/node-qrcode) 生成。官方微信渠道实现可参考 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)。

本项目为社区 Pi 扩展，采用 [MIT License](LICENSE)。
