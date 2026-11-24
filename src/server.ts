import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MockChannel, systemClock } from "./channel";
import { loadConfig, type Config } from "./config";
import { renderMetricsPage, summarize } from "./metrics";
import { LeadStore, Pipeline } from "./pipeline";
import type { LeadStatus } from "./types";

const MAX_BODY_BYTES = 64 * 1024;
const STATUS_CODE: Record<LeadStatus, number> = { responded: 201, duplicate: 200, rejected: 422, failed: 502 };

function send(res: ServerResponse, code: number, body: unknown, contentType = "application/json"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": `${contentType}; charset=utf-8` });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function secretMatches(expected: string, given: string | string[] | undefined): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(typeof given === "string" ? given : "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(pipeline: Pipeline, store: LeadStore, config: Config): Server {
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;

      if (req.method === "POST" && path === "/webhook/lead") {
        if (config.webhookSecret && !secretMatches(config.webhookSecret, req.headers["x-webhook-secret"])) {
          return send(res, 401, { error: "bad or missing x-webhook-secret" });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: "body must be valid JSON under 64 KB" });
        }
        const record = await pipeline.handle(parsed);
        return send(res, STATUS_CODE[record.status], record);
      }
      if (req.method === "GET" && path === "/metrics") {
        return send(res, 200, renderMetricsPage(summarize(store.all(), config.slaMs), store.all()), "text/html");
      }
      if (req.method === "GET" && path === "/metrics.json") {
        return send(res, 200, summarize(store.all(), config.slaMs));
      }
      if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
      return send(res, 404, { error: "not found" });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const store = new LeadStore();
  const channel = new MockChannel({ clock: systemClock, latencyMs: () => config.mockChannelLatencyMs });
  const pipeline = new Pipeline({ config, clock: systemClock, channel, store });
  createApp(pipeline, store, config).listen(config.port, () => {
    console.log(`speed-to-lead listening on http://localhost:${config.port}`);
    console.log(`POST /webhook/lead   GET /metrics   GET /metrics.json   channel: ${config.channelMode}`);
  });
}
