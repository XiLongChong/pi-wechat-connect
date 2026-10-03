export async function showTerminalLogin(ctx, authorization, ui) {
  if (ctx.mode !== "tui") throw new Error("扫码登录需要交互终端，请运行 pi 后使用 /weixin-login。");
  await authorization.connect();
  try {
    return await ctx.ui.custom((tui, _theme, _keys, done) => {
      const input = new ui.Input();
      let state, error;
      let disposed = false, updating = false, submitting = false, focused = false;
      const refresh = async () => {
        if (disposed || updating) return;
        updating = true;
        try {
          const next = await authorization.status();
          if (disposed) return;
          state = next.operation;
          if (next.connected) done(true);
          else if (state.phase === "failed") { ctx.ui.notify(state.message, "error"); done(false); }
          else tui.requestRender();
        } catch (cause) {
          if (!disposed) { ctx.ui.notify(cause.message, "error"); done(false); }
        } finally { updating = false; }
      };
      input.onSubmit = async (code) => {
        if (!state?.requiresVerifyCode || submitting) return;
        submitting = true;
        try { await authorization.submitVerifyCode(code); input.setValue(""); error = undefined; await refresh(); }
        catch (cause) { error = cause.message; tui.requestRender(); }
        finally { submitting = false; }
      };
      const timer = setInterval(() => void refresh(), 250);
      void refresh();
      return {
        get focused() { return focused; },
        set focused(value) { focused = value; input.focused = value; },
        render(width) {
          const text = (line) => ui.truncateToWidth(line, width);
          const lines = [text("微信扫码登录 / WeChat login"), text(state?.message ?? "正在获取二维码…"), ""];
          const qr = state?.terminalQr;
          // Never wrap or truncate a QR: that silently creates an invalid code.
          if (qr) {
            const requiredRows = qr.rows.length + (state?.requiresVerifyCode ? 8 : 5) + 6;
            if (width < qr.width) lines.push(text(`请加宽终端：二维码需要 ${qr.width} 列。`));
            else if (tui.terminal.rows < requiredRows) lines.push(text(`请加高终端或缩小字号：需要 ${requiredRows} 行。`));
            else lines.push(...qr.rows);
          }
          if (state?.requiresVerifyCode) lines.push("", text("输入手机显示的数字配对码，按 Enter："), ...input.render(width));
          if (error) lines.push(text(error));
          lines.push("", text("Esc / Ctrl+C 取消；二维码过期后自动刷新。"));
          return lines;
        },
        handleInput(data) {
          if (ui.matchesKey(data, ui.Key.escape) || ui.matchesKey(data, ui.Key.ctrl("c"))) done(false);
          else if (state?.requiresVerifyCode) { input.handleInput(data); tui.requestRender(); }
        },
        invalidate() { input.invalidate(); },
        dispose() { disposed = true; clearInterval(timer); },
      };
    });
  } finally {
    if (!(await authorization.status()).connected) await authorization.cancelConnect();
  }
}
