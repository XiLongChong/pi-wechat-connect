import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default async function (pi) {
  // Native ESM preserves worker URLs and dependency resolution.
  const { registerTerminalWeixin } = await import("./terminal-extension.mjs");
  const { resolveStateDirectory } = await import("./state-directory.mjs");
  registerTerminalWeixin(pi, { Input, Key, matchesKey, truncateToWidth, Type }, {
    directory: resolveStateDirectory(getAgentDir()),
  });
}
