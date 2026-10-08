import type { IncomingMessage } from "node:http";

const MAX_BODY_BYTES = 16 * 1024;

/** 读原始请求体（文本），最多 16 KB。 */
export function readRawBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    request.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new Error("请求体过大。"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

/** 读 JSON 请求体，最多 16 KB；空请求体当作 {}。 */
export async function readBody(request: IncomingMessage): Promise<unknown> {
  const text = await readRawBody(request);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体不是合法的 JSON。");
  }
}
