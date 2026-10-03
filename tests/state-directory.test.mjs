import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveStateDirectory } from "../state-directory.mjs";

test("state stays under the Pi agent directory regardless of package installation location", () => {
  const agentDir = path.resolve("test-agent");
  assert.equal(resolveStateDirectory(agentDir, {}), path.join(agentDir, "pi-wechat-connect"));
});

test("an absolute override preserves access to an existing state directory", () => {
  const existingState = path.resolve("existing-weixin-state");
  assert.equal(resolveStateDirectory(path.resolve("test-agent"), { PI_WECHAT_STATE_DIR: existingState }), existingState);
  assert.throws(() => resolveStateDirectory(path.resolve("test-agent"), { PI_WECHAT_STATE_DIR: "relative-state" }), /绝对路径/);
});
