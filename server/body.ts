import type { IncomingMessage } from "node:http";

const MAX_BODY_BYTES = 16 * 1024;

/** 读 JSON 请求体，最多 16 KB；空请求体当作 {}。 */
export function readBody(request: IncomingMessage): Promise<unknown> {
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
      if (failed) return;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法的 JSON。"));
      }
    });
    request.on("error", reject);
  });
}
