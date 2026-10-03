import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

test("Pi 1.0 loads the distributed entry and registers the send tool and commands", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "pi-wechat-load-"));
  try {
    const entry = fileURLToPath(new URL("../index.js", import.meta.url));
    const loader = new DefaultResourceLoader({
      cwd: temporary,
      agentDir: path.join(temporary, "agent"),
      additionalExtensionPaths: [entry],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const extension = result.extensions.find((item) => item.resolvedPath === entry);
    assert.ok(extension);
    assert.ok(extension.tools.has("wechat_send_message"));
    for (const command of ["weixin-login", "weixin-bind", "weixin-status", "weixin-reconnect", "weixin-unbind", "weixin-disconnect"]) {
      assert.ok(extension.commands.has(command), command);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
