import { parentPort, workerData } from "node:worker_threads";
const { WeChatBot } = await import(workerData.sdkUrl);
import { createTerminalQr } from "./terminal-qr.mjs";
const { WeixinStorage } = await import(workerData.storageUrl);

let resolveCode;
let qrRendering = Promise.resolve();
parentPort.on("message", (message) => {
  if (message.type === "verify-code" && resolveCode) {
    const resolve = resolveCode;
    resolveCode = undefined;
    resolve(message.code);
  }
});

try {
  const bot = new WeChatBot({
    storage: new WeixinStorage(workerData.directory),
    logLevel: "silent",
    botAgent: "PiWeixinTerminal/0.1.0",
  });
  await bot.login({
    callbacks: {
      onQrUrl(value) {
        // 回调不被 SDK await；串行转换，避免旧二维码晚到覆盖新二维码。
        qrRendering = qrRendering.then(async () => {
          const terminalQr = createTerminalQr(value);
          parentPort.postMessage({ type: "qr", terminalQr });
        });
        void qrRendering.catch(() => parentPort.postMessage({ type: "failed", message: "无法生成微信二维码，请重新连接。" }));
      },
      onScanned() { void qrRendering.then(() => parentPort.postMessage({ type: "scanned" })); },
      onExpired() { void qrRendering.then(() => parentPort.postMessage({ type: "expired" })); },
      async onVerifyCode(isRetry) {
        await qrRendering;
        const pending = new Promise((resolve) => { resolveCode = resolve; });
        parentPort.postMessage({ type: "verify-code", isRetry });
        return pending;
      },
    },
  });
  await qrRendering;
  // login 已等待 SDK 持久化完成；不通过 IPC 或 HTTP 暴露 bot_token。
  parentPort.postMessage({ type: "connected" });
} catch (error) {
  parentPort.postMessage({ type: "failed", message: Number.isInteger(error?.errcode)
    ? `微信授权失败（错误码 ${error.errcode}），请重新连接。`
    : "微信授权未完成，请检查网络或重新扫码。" });
} finally {
  parentPort.close();
}
