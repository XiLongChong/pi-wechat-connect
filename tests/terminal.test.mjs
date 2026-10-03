import assert from "node:assert/strict";
import test from "node:test";
import * as tui from "@earendil-works/pi-tui";
import { Type } from "typebox";
import path from "node:path";
import jsQR from "jsqr";
import { createTerminalQr } from "../terminal-qr.mjs";
import { showTerminalLogin } from "../login-ui.mjs";
import { registerTerminalWeixin } from "../terminal-extension.mjs";

const ui = { ...tui, Type };
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

function decodeTerminalQr(qr) {
  // Decode the displayed ANSI/half-block output, not the original QR matrix.
  const scale = 6;
  const width = qr.width * scale;
  const height = qr.rows.length * 2 * scale;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  qr.rows.forEach((row, rowIndex) => {
    const cells = [...row.matchAll(/\x1b\[38;2;(\d+);\d+;\d+m\x1b\[48;2;(\d+);\d+;\d+m▀/g)];
    assert.equal(cells.length, qr.width);
    cells.forEach((cell, x) => {
      for (let half = 0; half < 2; half++) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const offset = (((rowIndex * 2 + half) * scale + dy) * width + x * scale + dx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = Number(cell[half + 1]);
      }
    });
  });
  return jsQR(pixels, width, height)?.data;
}

test("terminal QR output decodes with quiet zone across realistic URL lengths", () => {
  for (const value of ["https://weixin.qq.com/q/test", "https://weixin.qq.com/x/" + "a".repeat(160)]) {
    const qr = createTerminalQr(value);
    assert.equal(decodeTerminalQr(qr), value);
    assert.equal(qr.rows.every((row) => ui.visibleWidth(row) === qr.width), true);
  }
});

function loginHarness(operation, rows = 60) {
  let component, finish;
  const state = { connected: false, operation };
  const calls = { cancelled: 0, codes: [] };
  const auth = {
    async connect() {}, async status() { return state; },
    async cancelConnect() { calls.cancelled++; },
    async submitVerifyCode(code) {
      calls.codes.push(code);
      state.connected = true;
    },
  };
  const ctx = { mode: "tui", ui: {
    notify() {},
    custom(factory) { return new Promise((resolve) => {
      finish = (value) => { component.dispose(); resolve(value); };
      component = factory({ requestRender() {}, terminal: { rows } }, {}, {}, finish);
    }); },
  } };
  const result = showTerminalLogin(ctx, auth, ui);
  return { state, calls, result, get component() { return component; } };
}

test("login QR is never cropped on narrow terminals; Escape cancels worker", async () => {
  const qr = createTerminalQr("https://weixin.qq.com/q/test");
  const h = loginHarness({ phase: "authorizing", message: "Scan", terminalQr: qr });
  await tick();
  assert.equal(h.component.render(20).some((line) => line.includes("▀")), false);
  assert.equal(h.component.render(100).filter((line) => line.includes("▀")).length, qr.rows.length);
  h.component.handleInput("\x1b");
  assert.equal(await h.result, false);
  assert.equal(h.calls.cancelled, 1);
});

test("pairing input submits code and successful login retains authorization", async () => {
  const h = loginHarness({ phase: "authorizing", message: "Code", requiresVerifyCode: true });
  await tick();
  for (const key of ["1", "2", "3", "4", "\r"]) h.component.handleInput(key);
  assert.equal(await h.result, true);
  assert.deepEqual(h.calls.codes, ["1234"]);
  assert.equal(h.calls.cancelled, 0);
});

test("short terminal asks for height instead of rendering a clipped QR", async () => {
  const qr = createTerminalQr("https://weixin.qq.com/q/test");
  const h = loginHarness({ phase: "authorizing", message: "Scan", terminalQr: qr }, 24);
  await tick();
  const lines = h.component.render(100);
  assert.equal(lines.some((line) => line.includes("▀")), false);
  assert.equal(lines.some((line) => line.includes("加高终端")), true);
  h.component.handleInput("\x1b");
  await h.result;
});

test("expired QR disappears and replacement QR renders on refresh", async () => {
  const qr = createTerminalQr("https://weixin.qq.com/q/old");
  const h = loginHarness({ phase: "authorizing", message: "Scan", terminalQr: qr });
  await tick();
  h.state.operation = { phase: "configuring", message: "Expired" };
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(h.component.render(100).some((line) => line.includes("▀")), false);
  const replacement = createTerminalQr("https://weixin.qq.com/q/new");
  h.state.operation = { phase: "authorizing", message: "Scan", terminalQr: replacement };
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(decodeTerminalQr({ ...replacement, rows: h.component.render(100).filter((line) => line.includes("▀")) }), "https://weixin.qq.com/q/new");
  h.component.handleInput("\x1b");
  await h.result;
});

test("adapter targets current native session and preserves followUp behavior", async () => {
  const commands = new Map(), handlers = new Map(), delivered = [];
  let adapter, boundId, closed = false;
  const pi = {
    registerTool() {}, registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    getSessionName() { return "test"; },
    sendUserMessage(content, options) { delivered.push({ content, options }); },
  };
  const connection = {
    async configure(host) { adapter = host; },
    async bind(id) { boundId = id; },
    async close() { closed = true; },
    async status() { return { connected: true, receiver: { message: "ready" } }; },
    setTyping() {},
  };
  const ctx = { mode: "tui", sessionManager: { getSessionId() { return "native-session"; } }, ui: { notify() {}, setStatus() {} } };
  registerTerminalWeixin(pi, ui, { directory: path.resolve("test-weixin-state"), connection, authorization: { async status() { return { connected: true }; } } });
  for (const handler of handlers.get("session_start")) await handler({}, ctx);
  await commands.get("weixin-login").handler("", ctx);
  assert.equal(boundId, "native-session");
  await adapter.sendMessage("native-session", { content: "<wechat_message>\nhello\n</wechat_message>" });
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", expandPromptTemplates: false });
  await assert.rejects(adapter.sendMessage("other-session", { content: "hello" }), /切换/);
  for (const handler of handlers.get("session_shutdown")) await handler({}, ctx);
  assert.equal(closed, true);
});
