import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WeixinStorage, validCredentials } from "./storage.mjs";
import { wrapWeChatMessage } from "./message-protocol.mjs";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { imageExtension, saveWeChatAttachments, removeWeChatImages } from "./attachments.mjs";

export function createWeixinConnection({ directory, authorization, attachmentRoot = path.join(directory, "attachments"), workerFactory = (url, options) => new Worker(url, options) }) {
  const storage = new WeixinStorage(directory);
  let host;
  let worker;
  let binding;
  let receiver = { phase: "unbound", message: "尚未绑定对话。" };
  let mutation = Promise.resolve();
  let delivery = Promise.resolve();
  let closed = false;
  let sendId = 0;
  const pendingSends = new Map();
  const failSends = () => {
    for (const request of pendingSends.values()) request.reject(new Error("微信连接已关闭，消息发送结果未确认。"));
  };
  const serialize = (action) => {
    const result = mutation.then(action);
    mutation = result.catch(() => {});
    return result;
  };
  const credentials = async () => {
    const value = await storage.get("credentials");
    return validCredentials(value) ? value : undefined;
  };
  const readBinding = async () => {
    const value = await storage.get("binding");
    if (!value) return undefined;
    if (value.version !== 1 || !["threadId", "accountId", "userId", "boundAt"].every((key) => typeof value[key] === "string" && value[key])) {
      throw new Error("微信对话绑定记录损坏，请解除对话绑定后重新绑定。");
    }
    return value;
  };
  const stop = async () => {
    const current = worker;
    worker = undefined;
    failSends();
    if (current) {
      // 最多给输入提示取消留 2 秒；不可用的网络不能拖住解绑和退出。
      if (typeof current.postMessage === "function") {
        await new Promise((resolve) => {
          const finish = () => { clearTimeout(timer); current.off("message", onMessage); resolve(); };
          const onMessage = (event) => { if (event.type === "shutdown-ready") finish(); };
          const timer = setTimeout(finish, 2_000);
          current.on("message", onMessage);
          try { current.postMessage({ type: "shutdown" }); } catch { finish(); }
        });
      }
      await current.terminate();
    }
    await delivery;
  };
  const requireThread = async (threadId) => {
    if (!host) throw new Error("微信接收服务尚未就绪。");
    const thread = await host.getThread(threadId);
    if (thread.metadata.archived) throw new Error("绑定的对话已归档，请先恢复对话或更换绑定。");
    return thread;
  };
  const start = async () => {
    if (closed || worker || !host) return;
    binding = await readBinding();
    const creds = await credentials();
    if (!creds) { receiver = { phase: "unauthorized", message: "请先扫码授权个人微信。" }; return; }
    if (!binding) { receiver = { phase: "unbound", message: "授权已保存，请绑定一个对话以接收微信消息。" }; return; }
    if (binding.accountId !== creds.accountId || binding.userId !== creds.userId) {
      receiver = { phase: "error", message: "微信账号已变化，请重新绑定对话。" }; return;
    }
    try { await requireThread(binding.threadId); }
    catch { receiver = { phase: "error", message: "绑定的对话不可用，请恢复对话或更换绑定。" }; return; }
    receiver = { phase: "connecting", message: "正在恢复微信消息接收…" };
    const entryPath = fileURLToPath(new URL("./receive-worker.mjs", import.meta.url)).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
    let current;
    try {
      current = workerFactory(pathToFileURL(entryPath), { workerData: {
        directory, userId: creds.userId, sdkUrl: import.meta.resolve("@wechatbot/wechatbot"),
        storageUrl: new URL("./storage.mjs", import.meta.url).href,
      } });
    } catch {
      receiver = { phase: "error", message: "微信接收服务启动失败，请重新连接。" };
      return;
    }
    worker = current;
    const target = { ...binding };
    current.on("message", (event) => {
      if (worker !== current) return;
      if (event.type === "send-result") {
        const request = pendingSends.get(event.id);
        if (request) {
          if (event.sent) request.resolve({ sent: true, type: request.type });
          else request.reject(new Error("微信消息发送失败，请检查连接和授权；未自动重发。"));
        }
        return;
      }
      if (event.type === "receiving") receiver = { phase: "receiving", message: "微信消息将进入绑定的对话。" };
      else if (event.type === "recovered" && receiver.phase === "retrying") receiver = { phase: "receiving", message: "微信消息将进入绑定的对话。" };
      else if (event.type === "retrying") receiver = { phase: "retrying", message: "微信网络连接异常，正在自动重试。" };
      else if (event.type === "expired") receiver = { phase: "unauthorized", message: "微信授权已过期，请重新扫码授权。" };
      else if (event.type === "failed") receiver = { phase: "error", message: "微信接收服务启动失败，请重新连接。" };
      else if (event.type === "image-error") receiver = { phase: "error", message: "微信图片下载失败或格式不支持，请重新发送图片。" };
      else if (event.type === "attachment-error") receiver = { phase: "error", message: "微信附件下载失败，请重新发送文件或图片。" };
      else if (["text", "image", "attachment"].includes(event.type) && typeof event.text === "string"
        && (event.text.trim() || (Array.isArray(event.images) && event.images.length) || (Array.isArray(event.files) && event.files.length))) {
        // 这里只串行提交传输命令；忙时的消息队列由 Pi 的 followUp 管理。
        delivery = delivery.then(async () => {
          if (worker !== current) return;
          const id = typeof event.id === "string" || typeof event.id === "number" ? String(event.id) : undefined;
          const savedIds = await storage.get("received_ids");
          const seen = Array.isArray(savedIds) ? savedIds.filter((value) => typeof value === "string") : [];
          const key = id ? `${target.accountId}:${id}` : undefined;
          if (key && seen.includes(key)) return;
          await requireThread(target.threadId);
          const references = event.type !== "text"
            ? await saveWeChatAttachments({ root: attachmentRoot, threadId: target.threadId, images: event.images, files: event.files })
            : [];
          if (worker !== current) { await removeWeChatImages(references); return; }
          // 提交可能已写入 Pi 历史后才失败，保留完整附件，避免历史路径失效。
          await host.sendMessage(target.threadId, { content: wrapWeChatMessage(event.text, references), streamingBehavior: "followUp" });
          if (key) await storage.set("received_ids", [...seen, key].slice(-512));
          receiver = { phase: "receiving", message: "微信消息将进入绑定的对话。" };
        }).catch(() => { receiver = { phase: "error", message: "微信消息未能进入对话，请检查会话和模型配置后重新发送。" }; });
      }
    });
    current.on("error", () => {
      if (worker === current) { failSends(); receiver = { phase: "error", message: "微信接收服务异常，请重新连接。" }; }
    });
    current.on("exit", () => {
      if (worker !== current) return;
      worker = undefined;
      failSends();
      if (receiver.phase !== "unauthorized") receiver = { phase: "error", message: "微信接收服务已退出，请重新连接。" };
    });
  };
  const restore = () => serialize(start);
  const setTyping = (threadId, active) => {
    if (!worker || closed || binding?.threadId !== threadId || receiver.phase === "unauthorized") return;
    try { worker.postMessage({ type: "typing", active: active === true }); } catch { /* 非关键传输。 */ }
  };
  const send = (threadId, content, signal) => serialize(async () => {
    if (signal?.aborted) throw new Error("微信发送已取消。");
    if (content?.type === "text") {
      if (typeof content.text !== "string" || !content.text.trim()) throw new Error("text 消息必须为非空文字。");
    } else if (["image", "file"].includes(content?.type)) {
      if (typeof content.path !== "string" || !path.isAbsolute(content.path)) throw new Error(`${content.type} 消息需要本地文件的绝对路径。`);
    } else throw new Error("当前仅支持 text、image 和 file 消息。");
    const saved = await readBinding();
    const creds = await credentials();
    if (!creds) throw new Error("请先扫码授权个人微信。");
    if (!saved || saved.threadId !== threadId) throw new Error("当前对话未绑定微信，不能发送消息。");
    if (saved.accountId !== creds.accountId || saved.userId !== creds.userId) throw new Error("微信账号已变化，请重新绑定对话。");
    await requireThread(threadId);
    let transport = { type: "text", text: content.text };
    if (content.type !== "text") {
      let bytes;
      try {
        if (!(await stat(content.path)).isFile()) throw new Error("Not a file");
        bytes = await readFile(content.path);
      } catch { throw new Error("无法读取文件，请确认绝对路径指向存在且可读取的文件。"); }
      if (content.type === "image") imageExtension(bytes); // 文件消息不限制后缀，不自动解压或执行。
      let name = path.basename(content.path);
      // 回传收到的附件时去掉本程序的防重名编号；项目文件保留自身文件名。
      const relative = path.relative(attachmentRoot, content.path).split(path.sep);
      const storedName = relative[2]?.match(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-(.+)$/i);
      if (relative.length === 3 && /^[a-zA-Z0-9_-]{1,128}$/.test(relative[0]) && relative[1] === "wechat" && storedName) name = storedName[1];
      transport = { type: content.type, bytes, name };
    }
    await start();
    if (!worker || ["unauthorized", "error"].includes(receiver.phase)) throw new Error("微信连接不可用，请重新连接。");
    if (signal?.aborted) throw new Error("微信发送已取消。");
    const current = worker;
    const id = ++sendId;
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); pendingSends.delete(id); callback(value); };
      const timer = setTimeout(() => finish(reject, new Error("微信发送超时，结果未确认；未自动重发。")), content.type === "text" ? 60_000 : 180_000);
      pendingSends.set(id, { type: content.type, resolve: (value) => finish(resolve, value), reject: (error) => finish(reject, error) });
      // 已提交的网络发送不能撤回；等真实结果，不把模型中止伪装成发送失败。
      try { current.postMessage({ type: "send", id, content: transport }); }
      catch { finish(reject, new Error("微信发送命令提交失败。")); }
    });
  });
  const status = async () => {
    await restore();
    const auth = await authorization.status();
    const saved = await readBinding();
    let title;
    if (saved && host) title = await host.getThread(saved.threadId).then((thread) => thread.metadata.title).catch(() => undefined);
    return { ...auth, binding: saved ? { threadId: saved.threadId, boundAt: saved.boundAt, title } : undefined, receiver: { ...receiver } };
  };
  const bind = (threadId) => serialize(async () => {
    if (typeof threadId !== "string" || !threadId.trim()) throw new Error("请先创建一个对话，再绑定微信。");
    const creds = await credentials();
    if (!creds) throw new Error("请先扫码授权个人微信。");
    await requireThread(threadId);
    await host.prepareBinding?.(threadId);
    await stop();
    binding = { version: 1, threadId, accountId: creds.accountId, userId: creds.userId, boundAt: new Date().toISOString() };
    await storage.set("binding", binding);
    await start();
    return { bound: true };
  });
  const unbind = () => serialize(async () => {
    await stop();
    await storage.delete("binding");
    binding = undefined;
    receiver = { phase: "unbound", message: "已解除对话绑定，微信授权仍保留。" };
    return { unbound: true };
  });
  const disconnect = () => serialize(async () => {
    await stop();
    await storage.delete("binding");
    await storage.delete("received_ids");
    binding = undefined;
    await authorization.disconnect();
    receiver = { phase: "unauthorized", message: "个人微信已解除授权。" };
    return { disconnected: true };
  });
  const reconnect = () => serialize(async () => { await stop(); await start(); return { accepted: true }; });
  const close = () => serialize(async () => { closed = true; await stop(); await authorization.cancelConnect(); });
  const configure = (adapter) => { host = adapter; return restore(); };
  return { status, bind, unbind, reconnect, disconnect, restore, configure, close, send, setTyping,
    connect: authorization.connect, cancelConnect: authorization.cancelConnect, submitVerifyCode: authorization.submitVerifyCode };
}

let connection;
let connectionDirectory;
export function getWeixinConnection(options) {
  if (connection && connectionDirectory !== options.directory) throw new Error("微信连接目录不能在运行期间切换。");
  connectionDirectory = options.directory;
  return connection ??= createWeixinConnection(options);
}
