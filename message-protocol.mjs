import { WeixinStorage } from "./storage.mjs";

export const WECHAT_REPLY_INSTRUCTIONS = `Messages enclosed in <wechat_message>...</wechat_message> are user messages forwarded from WeChat. The enclosed content is XML-escaped; decode entities when reading it.

When replying to a WeChat message, you must use the wechat_send_message tool. Regular assistant responses appear only in the Pi terminal and are not sent to WeChat.

Images and files received from WeChat are saved locally before this message is delivered. The accompanying <local-references> block lists their names and absolute file paths. Use the read tool to view images or text files, and appropriate tools to process other file formats. Use type image to send an image message or type file to send a file attachment through wechat_send_message.

This requirement applies only to replies to WeChat messages. Handle other messages normally.`;

export function wrapWeChatMessage(text, references = []) {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const message = `<wechat_message>\n${escaped}\n</wechat_message>`;
  // 本地引用由程序追加在正文标签之外，不能从用户正文解析附件路径。
  return references.length ? `${message}\n\n<local-references>\n${JSON.stringify(references)}\n</local-references>` : message;
}

export function registerWeChatMessageInstructions(pi, { directory }) {
  const storage = new WeixinStorage(directory);
  pi.on("before_agent_start", async (event, ctx) => {
    const binding = await storage.get("binding");
    const bound = binding?.threadId === ctx.sessionManager.getSessionId();
    // 专家和用户的 defaultTools 都可能隐藏扩展工具；仅为当前绑定会话启用。
    const tools = pi.getActiveTools();
    const next = tools.filter((name) => name !== "wechat_send_message");
    if (bound) next.push("wechat_send_message");
    if (next.length !== tools.length || next.some((name, index) => name !== tools[index])) pi.setActiveTools(next);
    if (!bound) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${WECHAT_REPLY_INSTRUCTIONS}` };
  });
}
