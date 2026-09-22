import { connect } from "node:net";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { once } from "node:events";

/** Fail closed on unavailable scanners, truncated replies, timeouts and malware. */
export async function scanWithClamAV(
  file: string, host: string, port: number, maxBytes: number, timeoutMs = 180_000,
): Promise<void> {
  const size = (await stat(file)).size;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || size > maxBytes)
    throw new Error("File exceeds the configured ClamAV stream limit; it was not marked clean");
  const socket = connect({ host, port });
  const source = createReadStream(file, { highWaterMark: 64 * 1024 });
  let reply = "", settled = false, streamSent = false;
  let resolveVerdict!: () => void, rejectVerdict!: (error: Error) => void;
  const verdict = new Promise<void>((resolve, reject) => {
    resolveVerdict = resolve; rejectVerdict = reject;
  });
  // Observe a rejection immediately, including failures before the connect await.
  void verdict.catch(() => {});
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true; rejectVerdict(error); socket.destroy(); source.destroy();
  };
  const timer = setTimeout(() => fail(new Error("Antivirus scan timed out")), timeoutMs);
  socket.on("error", fail);
  source.on("error", fail);
  socket.on("close", () => {
    if (!settled) fail(new Error("Antivirus connection closed without a complete verdict"));
  });
  socket.on("data", chunk => {
    reply += chunk.toString("utf8");
    if (reply.length > 4096) return fail(new Error("Invalid antivirus response"));
    if (!reply.includes("\0") && !reply.includes("\n")) return;
    if (!/^stream: OK[\0\r\n]*$/.test(reply))
      return fail(new Error(reply.includes("FOUND") ? "MALWARE_DETECTED" : "Antivirus could not complete the scan"));
    if (!streamSent) return fail(new Error("Antivirus returned a premature clean verdict"));
    if (!settled) { settled = true; resolveVerdict(); socket.end(); }
  });
  const write = async (buffer: Buffer | string): Promise<void> => {
    await Promise.race([
      new Promise<void>((resolve, reject) => socket.write(buffer, error => error ? reject(error) : resolve())),
      verdict,
    ]);
  };
  try {
    await Promise.race([once(socket, "connect"), verdict]);
    await write("zINSTREAM\0");
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
      await write(length); await write(bytes);
    }
    streamSent = true;
    await write(Buffer.alloc(4));
    await verdict;
  } finally {
    clearTimeout(timer); source.destroy(); socket.destroy();
  }
}
