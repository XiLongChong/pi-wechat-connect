import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function imageExtension(bytes) {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return ".jpg";
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return ".gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (data.subarray(0, 2).toString("ascii") === "BM") return ".bmp";
  throw new Error("微信图片格式暂不支持或内容已损坏。");
}

export function safeWeChatFileName(value) {
  let name = typeof value === "string" ? value.split(/[\\/]/).pop() : "";
  name = (name ?? "").replace(/[<>:"|?*\x00-\x1f\x7f]/g, "_").replace(/[. ]+$/, "").trim();
  if (!name || name === "." || name === "..") return "attachment.bin";
  const ext = path.extname(name);
  return name.length > 180 ? (ext.length <= 20 ? name.slice(0, 180 - ext.length) + ext : name.slice(0, 180)) : name;
}

export function saveWeChatImages(options) {
  return saveWeChatAttachments(options);
}

export async function saveWeChatAttachments({ root, threadId, images = [], files = [] }) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new Error("附件会话 ID 无效。");
  const directory = path.join(root, threadId, "wechat");
  const saved = [];
  try {
    const entries = [
      ...images.map((bytes) => ({ bytes, kind: "image" })),
      ...files.map((file) => ({ bytes: file.bytes, name: safeWeChatFileName(file.name), kind: "other" })),
    ];
    for (const entry of entries) {
      const { bytes, kind } = entry;
      if (!(bytes instanceof Uint8Array)) throw new Error("微信附件内容无效。");
      const storedName = randomUUID() + (kind === "image" ? imageExtension(bytes) : "-" + entry.name);
      const name = kind === "image" ? storedName : entry.name;
      const referencePath = path.resolve(directory, storedName);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = referencePath + ".partial";
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, referencePath);
      } finally { await rm(temporary, { force: true }); }
      saved.push({ referencePath, name, kind });
    }
    return saved;
  } catch (error) {
    await removeWeChatImages(saved);
    throw error;
  }
}

export async function removeWeChatImages(references) {
  await Promise.all(references.map((item) => rm(item.referencePath, { force: true })));
}
