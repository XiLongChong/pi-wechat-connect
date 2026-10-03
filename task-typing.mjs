function latestUserText(messages) {
  const message = messages.findLast((item) => item.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content) || message.content.some((part) => part.type !== "text")) return "";
  return message.content.map((part) => part.text).join("");
}

export function isWeChatTask(messages) {
  return /^<wechat_message>\r?\n[\s\S]*\r?\n<\/wechat_message>(?:\r?\n\r?\n<local-references>\r?\n[^\r\n]*\r?\n<\/local-references>)?$/.test(latestUserText(messages).trim());
}

export function registerWeChatTaskTyping(pi, connection) {
  const update = (ctx, active) => connection.setTyping(ctx.sessionManager.getSessionId(), active);
  const resume = (ctx) => {
    // Pi 原生分支只含已经消费的用户消息，尚未开始的 followUp 不在这里。
    const messages = ctx.sessionManager.getBranch().filter((entry) => entry.type === "message").map((entry) => entry.message);
    update(ctx, !ctx.isIdle() && isWeChatTask(messages));
  };
  // 扩展生命周期命令，不订阅第二条 Agent 状态流、不保存消息或运行状态。
  // 从原生分支判别，避免上下文压缩/扩展改写消息后丢失来源标签。
  pi.on("context", (_event, ctx) => { resume(ctx); });
  pi.on("ui_prompt_start", (_event, ctx) => { update(ctx, false); });
  pi.on("ui_prompt_end", (_event, ctx) => { resume(ctx); });
  for (const event of ["agent_end", "agent_settled", "session_shutdown", "session_before_switch"]) {
    pi.on(event, (_event, ctx) => { update(ctx, false); });
  }
}
