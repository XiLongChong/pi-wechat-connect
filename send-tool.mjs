export function registerWeChatSendTool(pi, connection, Type) {
  pi.registerTool({
    name: "wechat_send_message",
    label: "发送微信消息",
    description: "Send a message to the WeChat user associated with the current conversation. The recipient and reply context are resolved automatically.",
    executionMode: "sequential",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("text"), Type.Literal("image"), Type.Literal("file")], { description: "Use text for text, image for an image message, or file for a file attachment. File attachments remain files regardless of extension." }),
      text: Type.Optional(Type.String({ minLength: 1, description: "Required when type is text. The message content to send." })),
      path: Type.Optional(Type.String({ minLength: 1, description: "Required when type is image or file. Absolute path to an existing local file to send to the bound WeChat user. File messages preserve the filename." })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const result = await connection.send(ctx.sessionManager.getSessionId(), params, signal);
      return { content: [{ type: "text", text: "Message sent to WeChat." }], details: result };
    },
  });
}
