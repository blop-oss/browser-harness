// Bun compatibility shim for `chromium.connect()` (containerized runs).
//
// Playwright's client websocket lives in playwright-core's pre-bundled `ws`
// library, whose handshake rides node:http's connection-upgrade event. Bun's
// node:http client does not implement upgrade, so every connect() hangs and
// then fails with "Unexpected server response: 101". Bun's own `ws` shim
// (what a bare `require("ws")` resolves to under Bun) handshakes fine.
//
// The bundled `ws` itself cannot be swapped after load (frozen getters, and
// Bun evaluates CJS playwright during ESM linking, before any of our module
// bodies run). Instead this patches the one shared seam every connect path
// goes through: the static `WebSocketTransport.connect` on the class object
// in playwright-core/lib/server/transport.js. It is a no-op under Node.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.versions.bun) {
  const require = createRequire(import.meta.url);
  try {
    const playwrightDir = dirname(require.resolve("playwright/package.json"));
    const coreDir = dirname(require.resolve("playwright-core/package.json", { paths: [playwrightDir] }));
    let WebSocketTransport: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connect: (...args: any[]) => Promise<unknown>;
      __blopBunPatched?: boolean;
    };
    try {
      WebSocketTransport = require(join(coreDir, "lib", "server", "transport.js")).WebSocketTransport;
    } catch {
      WebSocketTransport = require("playwright-core/lib/coreBundle").server.WebSocketTransport;
    }

    if (!WebSocketTransport.__blopBunPatched) {
      const wsModule = require("ws");
      const BunWs = wsModule.WebSocket ?? wsModule;

      type ConnectOptions = { headers?: Record<string, string>; followRedirects?: boolean; debugLogHeader?: string };
      type Progress = { log: (message: string) => void; race: <T>(promise: Promise<T>) => Promise<T> } | undefined;

      WebSocketTransport.connect = async (progress: Progress, url: string, options: ConnectOptions = {}) => {
        const logUrl = url.split("?")[0];
        progress?.log(`<ws connecting> ${logUrl}`);
        const ws = new BunWs(url, [], {
          maxPayload: 256 * 1024 * 1024,
          headers: options.headers,
        });

        const t: {
          wsEndpoint: string;
          headers: { name: string; value: string }[];
          onmessage?: (message: object) => void;
          onclose?: (reason?: string) => void;
          send: (message: object) => void;
          close: () => void;
          closeAndWait: () => Promise<void>;
        } = {
          wsEndpoint: url,
          headers: [],
          send: (message) => ws.send(JSON.stringify(message)),
          close: () => {
            progress?.log(`<ws disconnecting> ${logUrl}`);
            ws.close();
          },
          closeAndWait: async () => {
            if (ws.readyState === BunWs.CLOSED) return;
            const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
            t.close();
            await closed;
          },
        };

        ws.addEventListener("message", (event: { data: unknown }) => {
          try {
            t.onmessage?.(JSON.parse(String(event.data)));
          } catch {
            ws.close();
          }
        });
        ws.addEventListener("close", (event: { code: number; reason: string }) => {
          progress?.log(`<ws disconnected> ${logUrl} code=${event.code} reason=${event.reason}`);
          t.onclose?.(event.reason);
        });

        const opened = new Promise((fulfill, reject) => {
          ws.once("open", () => {
            progress?.log(`<ws connected> ${logUrl}`);
            fulfill(undefined);
          });
          ws.once("error", (event: { message?: string }) => {
            progress?.log(`<ws connect error> ${logUrl} ${event.message}`);
            reject(new Error(`WebSocket error: ${event.message}`));
            ws.close();
          });
        });
        try {
          await (progress ? progress.race(opened) : opened);
        } catch (error) {
          try { await t.closeAndWait(); } catch {}
          throw error;
        }
        return t;
      };
      WebSocketTransport.__blopBunPatched = true;
    }
  } catch {
    // If playwright-core's internals moved, leave things untouched; the
    // containerized runner reports a clear error when connect() then fails.
  }
}
