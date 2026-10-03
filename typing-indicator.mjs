// 这是微信传输端的期望显示状态；不是 Agent 状态副本，不持久化。
export function createTypingIndicator({ start, stop, refreshMs = 8_000 }) {
  let desired = false;
  let requested = false;
  let closing = false;
  let running;
  let timer;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const drain = () => {
    if (running) return running;
    running = (async () => {
      while (requested) {
        requested = false;
        const active = desired;
        try { await (active ? start() : stop()); } catch { /* 输入提示失败不阻断任务和消息发送。 */ }
        if (active !== desired) requested = true;
      }
    })().finally(() => {
      running = undefined;
      if (requested) void drain();
      else if (desired && !closing) {
        timer = setTimeout(() => { timer = undefined; requested = true; void drain(); }, refreshMs);
        timer.unref?.();
      }
    });
    return running;
  };
  const set = (active) => {
    if (closing || desired === active) return;
    desired = active;
    clear();
    requested = true;
    void drain();
  };
  const refresh = () => {
    if (!desired || closing) return;
    clear();
    requested = true;
    void drain();
  };
  const close = async () => {
    closing = true;
    clear();
    if (desired || running) {
      desired = false;
      requested = true;
      await drain();
    }
  };
  return { set, refresh, close };
}
