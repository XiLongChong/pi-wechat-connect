import { FileStorage } from "@wechatbot/wechatbot";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// SDK 负责凭据格式与读写时机；原子替换避免进程退出留下半个授权文件。
export class WeixinStorage extends FileStorage {
  async set(key, value) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = this.filePath(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export function validCredentials(value) {
  return Boolean(value && ["token", "accountId", "userId", "savedAt"].every(
    (key) => typeof value[key] === "string" && value[key].trim(),
  ) && typeof value.baseUrl === "string" && /^https:\/\//.test(value.baseUrl));
}
