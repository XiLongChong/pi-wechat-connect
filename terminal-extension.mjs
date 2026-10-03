import { resolveStateDirectory } from "./state-directory.mjs";
import { createWeixinAuthorization } from "./authorization.mjs";
import { createWeixinConnection } from "./connection.mjs";
import { registerWeChatSendTool } from "./send-tool.mjs";
import { registerWeChatTaskTyping } from "./task-typing.mjs";
import { registerWeChatMessageInstructions } from "./message-protocol.mjs";
import { showTerminalLogin } from "./login-ui.mjs";

export function registerTerminalWeixin(pi, ui, options = {}) {
  const directory = options.directory ?? resolveStateDirectory();
  const authorization = options.authorization ?? createWeixinAuthorization({ directory });
  const connection = options.connection ?? createWeixinConnection({ directory, authorization });
  const configure = async (ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await connection.configure({
      async getThread(id) {
        if (id !== sessionId) throw new Error("绑定的会话不是当前终端会话，请使用 /weixin-bind。");
        return { metadata: { id, title: pi.getSessionName() ?? "Pi 终端会话", archived: false } };
      },
      async sendMessage(id, message) {
        if (id !== sessionId) throw new Error("微信消息目标会话已切换。");
        pi.sendUserMessage(message.content, { deliverAs: "followUp", expandPromptTemplates: false });
      },
    });
  };
  const bind = async (ctx) => {
    await configure(ctx);
    await connection.bind(ctx.sessionManager.getSessionId());
    ctx.ui.setStatus("weixin", "微信已绑定");
    ctx.ui.notify("微信已绑定当前 Pi 会话。请在手机给机器人发一条消息。", "info");
  };
  const command = (name, description, handler) => pi.registerCommand(name, {
    description,
    async handler(args, ctx) {
      try { await handler(args, ctx); }
      catch (error) { ctx.ui.notify(error.message, "error"); }
    },
  });
  registerWeChatSendTool(pi, connection, ui.Type);
  registerWeChatTaskTyping(pi, connection);
  registerWeChatMessageInstructions(pi, { directory });
  command("weixin-login", "在终端显示微信二维码，登录后绑定当前会话。", async (_args, ctx) => {
    if (ctx.mode !== "tui") throw new Error("请在交互终端中使用 /weixin-login。");
    if ((await authorization.status()).connected || await showTerminalLogin(ctx, authorization, ui)) await bind(ctx);
    else ctx.ui.notify("微信登录已取消或失败，请重试 /weixin-login。", "warning");
  });
  command("weixin-bind", "将已授权的微信绑定到当前 Pi 会话。", async (_args, ctx) => { await bind(ctx); });
  command("weixin-status", "查看微信授权、会话绑定和接收状态。", async (_args, ctx) => {
    const status = await connection.status();
    ctx.ui.notify(`${status.connected ? "已授权" : "未授权"}；${status.binding ? "已绑定会话 " + status.binding.threadId : "未绑定会话"}；${status.receiver.message}`, "info");
  });
  command("weixin-unbind", "停止接收微信消息，保留扫码授权。", async (_args, ctx) => {
    await connection.unbind(); ctx.ui.setStatus("weixin", undefined); ctx.ui.notify("已解除会话绑定，扫码授权保留。", "info");
  });
  command("weixin-disconnect", "停止连接并删除本地扫码授权。", async (_args, ctx) => {
    await connection.disconnect(); ctx.ui.setStatus("weixin", undefined); ctx.ui.notify("微信已断开，本地授权已删除。", "info");
  });
  command("weixin-reconnect", "恢复绑定会话的微信消息接收。", async (_args, ctx) => {
    await connection.reconnect(); ctx.ui.notify((await connection.status()).receiver.message, "info");
  });
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    await configure(ctx);
    const status = await connection.status();
    const bound = status.binding?.threadId === ctx.sessionManager.getSessionId();
    ctx.ui.setStatus("weixin", bound ? "微信已绑定" : status.connected ? "微信待绑定" : undefined);
    if (status.connected && !bound) ctx.ui.notify("微信授权已保存；使用 /weixin-bind 绑定当前会话。", "info");
  });
  pi.on("session_shutdown", async () => { await connection.close(); });
  return { directory, authorization, connection };
}
