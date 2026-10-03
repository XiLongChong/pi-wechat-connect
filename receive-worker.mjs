import { parentPort, workerData } from "node:worker_threads";

const { WeChatBot } = await import(workerData.sdkUrl);
const { WeixinStorage, validCredentials } = await import(workerData.storageUrl);
// worker 在 asar.unpacked 中，其余模块仍从原应用路径加载。
const { createTypingIndicator } = await import(new URL("./typing-indicator.mjs", workerData.storageUrl).href);
let expired = false;
class ReceivingStorage extends WeixinStorage {
  async set(key, value) {
    await super.set(key, value);
    // SDK 在成功的长轮询后保存游标；空消息批次也能确认网络已恢复。
    if (key === "cursor" && !expired) parentPort.postMessage({ type: "recovered" });
  }
}
const storage = new ReceivingStorage(workerData.directory);

// 接收服务不能进入 SDK 的自动扫码登录；授权过期后需用户重新执行登录命令。
class ReceiveOnlyBot extends WeChatBot {
  async login(options = {}) {
    if (options.force || !validCredentials(await storage.get("credentials"))) {
      throw new Error("请在 Pi 终端使用 /weixin-login 重新授权微信。");
    }
    return super.login(options);
  }
}
const bot = new ReceiveOnlyBot({ storage, logLevel: "silent", botAgent: "PiWeixinTerminal/0.1.0" });
const typing = createTypingIndicator({
  start: () => bot.sendTyping(workerData.userId),
  stop: () => bot.stopTyping(workerData.userId),
});
let closing = false;
let sends = Promise.resolve();
parentPort.on("message", (event) => {
  if (event.type === "shutdown") {
    closing = true;
    void typing.close().finally(() => { bot.stop(); parentPort.postMessage({ type: "shutdown-ready" }); });
    return;
  }
  if (closing || expired) return;
  if (event.type === "typing") { typing.set(event.active === true); return; }
  if (event.type !== "send") return;
  sends = sends.then(async () => {
    try {
      if (closing || expired) throw new Error("Connection closed");
      if (event.content?.type === "text" && typeof event.content.text === "string" && event.content.text.trim()) {
        await bot.send(workerData.userId, { text: event.content.text });
      } else if (event.content?.type === "image" && event.content.bytes instanceof Uint8Array && event.content.bytes.length) {
        await bot.send(workerData.userId, { image: Buffer.from(event.content.bytes) });
      } else if (event.content?.type === "file" && event.content.bytes instanceof Uint8Array && typeof event.content.name === "string") {
        // createMessage 先检查回复上下文。使用公开 API 强制 FILE，避免 SDK 根据后缀改发图片/视频。
        const builder = bot.createMessage(workerData.userId);
        const data = Buffer.from(event.content.bytes);
        const uploaded = await bot.upload({ data, userId: workerData.userId, mediaType: 3 });
        await bot.sendRaw(builder.file({ media: uploaded.media, fileName: event.content.name, size: data.length }).build());
      } else throw new Error("Invalid send");
      typing.refresh();
      parentPort.postMessage({ type: "send-result", id: event.id, sent: true });
    } catch {
      // 不跨线程传 SDK 错误原文，避免上游错误带回授权字段。
      parentPort.postMessage({ type: "send-result", id: event.id, sent: false });
    }
  });
});
bot.on("poll:start", () => parentPort.postMessage({ type: "receiving" }));
bot.on("session:expired", () => {
  expired = true;
  void typing.close();
  bot.stop();
  parentPort.postMessage({ type: "expired" });
});
bot.on("error", () => { if (!expired) parentPort.postMessage({ type: "retrying" }); });
let incoming = Promise.resolve();
bot.onMessage((message) => {
  // 仅接收授权者私聊的文本、图片和文件；从原始文本项取正文。
  if (message.userId !== workerData.userId || message.raw?.group_id || message.raw?.message_type !== 1
    || [message.voices, message.videos].some((items) => items?.length)
    || !message.raw?.item_list?.length
    || message.raw.item_list.some((item) => ![1, 2, 4].includes(item.type))) return;
  const text = message.raw.item_list.filter((item) => item.type === 1).map((item) => item.text_item?.text ?? "").join("\n");
  if (!text.trim() && !message.images.length && !message.files.length) return;
  // 图片下载与后续文本保持到达顺序，队列只承载连接器传输，不复制 Pi 队列。
  incoming = incoming.then(async () => {
    if (closing || expired) return;
    const images = [];
    for (const image of message.images) {
      if (!image.media) throw new Error("Image media missing");
      images.push(await bot.downloadRaw(image.media, image.aeskey));
    }
    const files = [];
    for (const file of message.files) {
      if (!file.media) throw new Error("File media missing");
      files.push({ bytes: await bot.downloadRaw(file.media), name: file.fileName });
    }
    if (closing || expired) return;
    parentPort.postMessage({ type: files.length ? "attachment" : images.length ? "image" : "text", text, images, files, id: message.raw.message_id });
  }).catch(() => {
    if (!closing && !expired) parentPort.postMessage({ type: "attachment-error" });
  });
});
try {
  await bot.login();
  await bot.start();
} catch {
  if (!expired) parentPort.postMessage({ type: "failed" });
}
