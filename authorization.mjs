import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WeixinStorage, validCredentials } from "./storage.mjs";

const LOGIN_TIMEOUT_MS = 10 * 60_000;

export function createWeixinAuthorization({ directory, workerFactory = (url, options) => new Worker(url, options) }) {
  const storage = new WeixinStorage(directory);
  let operation = { phase: "idle", message: "尚未绑定个人微信。" };
  let worker;
  let timer;
  let mutation = Promise.resolve();
  const serialize = (action) => {
    const result = mutation.then(action);
    mutation = result.catch(() => {});
    return result;
  };
  const readCredentials = async () => {
    const value = await storage.get("credentials");
    if (value !== undefined && !validCredentials(value)) throw new Error("微信授权文件损坏，请解绑后重新扫码。");
    return value;
  };
  const status = async () => {
    const credentials = await readCredentials();
    return {
      provider: "weixin", version: "2.2.0", installed: true,
      connected: Boolean(credentials), enabled: false,
      accountId: credentials?.accountId, savedAt: credentials?.savedAt,
      // 持久化授权是成功的事实源；worker 完成通知晚到时也不能继续显示旧二维码。
      operation: credentials
        ? { phase: "connected", message: "个人微信已授权，授权已保存。" }
        : { ...operation },
    };
  };
  const stopWorker = async () => {
    const current = worker;
    worker = undefined;
    clearTimeout(timer);
    timer = undefined;
    if (current) await current.terminate();
  };
  const connect = () => serialize(async () => {
    if (worker) return { accepted: true };
    if (await readCredentials()) {
      operation = { phase: "connected", message: "个人微信已授权，授权已保存。" };
      return { accepted: true };
    }
    operation = { phase: "configuring", message: "正在获取微信扫码二维码…" };
    // SDK 登录不支持 AbortSignal；独立 worker 可真正停止轮询及后续落盘。
    // Electron 的 worker 入口必须在真实磁盘；依赖仍从 app.asar 中的原路径加载。
    const entryPath = fileURLToPath(new URL("./auth-worker.mjs", import.meta.url)).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
    const current = workerFactory(pathToFileURL(entryPath), { workerData: {
      directory,
      sdkUrl: import.meta.resolve("@wechatbot/wechatbot"),
      storageUrl: new URL("./storage.mjs", import.meta.url).href,
    } });
    worker = current;
    current.on("message", (event) => {
      if (worker !== current) return;
      if (event.type === "qr") operation = { phase: "authorizing", message: "请用个人微信扫码，并在手机上确认绑定。", terminalQr: event.terminalQr };
      else if (event.type === "scanned") operation = { ...operation, message: "已扫码，请在手机上确认绑定。" };
      else if (event.type === "expired") operation = { phase: "configuring", message: "二维码已过期，正在刷新…" };
      else if (event.type === "verify-code") operation = {
        ...operation, phase: "authorizing", requiresVerifyCode: true,
        message: event.isRetry ? "配对码不匹配，请重新输入手机显示的配对码。" : "请填写微信手机端显示的配对码。",
      };
      else if (event.type === "connected") operation = { phase: "connected", message: "个人微信已授权，授权已保存。" };
      else if (event.type === "failed") operation = { phase: "failed", message: event.message };
    });
    current.on("error", () => {
      if (worker === current) operation = { phase: "failed", message: "微信登录服务异常，请重新连接。" };
    });
    current.on("exit", () => {
      if (worker !== current) return;
      worker = undefined;
      clearTimeout(timer);
      if (!["connected", "failed"].includes(operation.phase)) operation = { phase: "failed", message: "微信登录已中断，请重新连接。" };
    });
    timer = setTimeout(() => void serialize(async () => {
      if (worker !== current) return;
      await stopWorker();
      operation = { phase: "failed", message: "扫码等待超时，请重新连接。" };
    }), LOGIN_TIMEOUT_MS);
    timer.unref?.();
    return { accepted: true };
  });
  const cancelConnect = () => serialize(async () => {
    const cancelled = Boolean(worker);
    await stopWorker();
    operation = { phase: "idle", message: "已取消扫码连接。" };
    return { cancelled };
  });
  const disconnect = () => serialize(async () => {
    await stopWorker();
    for (const key of ["credentials", "cursor", "context_tokens", "typing_tickets"]) await storage.delete(key);
    operation = { phase: "idle", message: "个人微信已解绑，本地授权已移除。" };
    return { disconnected: true };
  });
  const submitVerifyCode = (code) => serialize(async () => {
    if (!worker || !operation.requiresVerifyCode) throw new Error("当前无需输入配对码。");
    if (typeof code !== "string" || !/^\d{4,12}$/.test(code.trim())) throw new Error("请输入手机上显示的数字配对码。");
    worker.postMessage({ type: "verify-code", code: code.trim() });
    operation = { ...operation, requiresVerifyCode: false, message: "正在确认配对码…" };
    return { accepted: true };
  });
  return { status, connect, cancelConnect, disconnect, submitVerifyCode };
}

let authorization;
let authorizationDirectory;
export function getWeixinAuthorization(directory) {
  if (authorization && authorizationDirectory !== directory) throw new Error("微信授权目录不能在运行期间切换。");
  authorizationDirectory = directory;
  return authorization ??= createWeixinAuthorization({ directory });
}
