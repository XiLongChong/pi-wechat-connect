import path from "node:path";
import { homedir } from "node:os";

export function resolveStateDirectory(agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"), env = process.env) {
  const override = env.PI_WECHAT_STATE_DIR?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error("PI_WECHAT_STATE_DIR 必须是绝对路径。");
    return path.normalize(override);
  }
  return path.resolve(agentDir, "pi-wechat-connect");
}
