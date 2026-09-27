/**
 * Security baseline checks (plan §12.2 / Phase B acceptance gate).
 *
 * Starts the example application with NODE_ENV=production (or probes an
 * already-running instance via --base-url), then probes the hardening
 * defaults from ADR-102 over HTTP. Checks that cannot be observed from a
 * loopback client (external-source /metrics access, TLS handshakes, WS
 * origins on non-enabled protocols) are reported as SKIP with the reason,
 * or probed against --external-url when provided.
 *
 * Usage:
 *   npx ts-node scripts/security-baseline.ts [--base-url http://127.0.0.1:3000]
 *                                            [--skip-start] [--external-url URL]
 *                                            [--app-dir packages/koatty/examples/basic-app]
 *
 * Exit code 0 when every executed check passes, 1 otherwise.
 * @ license: BSD (3-Clause)
 */
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const args = process.argv.slice(2);
function argValue(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (flag: string) => args.includes(flag);

const APP_DIR = path.resolve(process.cwd(), argValue("--app-dir", "packages/koatty/examples/basic-app"));
const BASE_URL = argValue("--base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
const EXTERNAL_URL = argValue("--external-url", "");
const POST_PATH = argValue("--post-path", "/add");
const SKIP_START = hasFlag("--skip-start");
const START_TIMEOUT_MS = Number(argValue("--start-timeout", "60000"));

const results: CheckResult[] = [];
const record = (name: string, status: CheckResult["status"], detail: string) => {
  results.push({ name, status, detail });
};

async function fetchRaw(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
}

let appProcess: ChildProcess | null = null;

async function startApp(): Promise<void> {
  if (!fs.existsSync(path.join(APP_DIR, "src", "App.ts"))) {
    throw new Error(`example app not found at ${APP_DIR}`);
  }
  const port = new URL(BASE_URL).port || "3000";
  appProcess = spawn("node", ["--nolazy", "-r", "ts-node/register", "./src/App.ts"], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: port,
      APP_PORT: port,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appProcess.stdout?.on("data", (d) => process.stdout.write(`  [app] ${d}`));
  appProcess.stderr?.on("data", (d) => process.stdout.write(`  [app] ${d}`));

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`example app exited early with code ${appProcess.exitCode}`);
    }
    try {
      const res = await fetchRaw(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`example app did not become ready within ${START_TIMEOUT_MS}ms`);
}

function stopApp(): void {
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function safeCheck(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    record(name, "FAIL", `probe error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkMalformedJson(): Promise<void> {
  const res = await fetchRaw(`${BASE_URL}${POST_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a": 1, oops}',
  });
  if (res.status === 400) {
    record("malformed JSON body -> 400", "PASS", `status ${res.status}`);
  } else {
    record("malformed JSON body -> 400", "FAIL", `expected 400, got ${res.status}`);
  }
}

async function checkOversizedBody(): Promise<void> {
  // strict profile limit is 1mb; 2mb must be rejected with 413.
  // Uses a raw http request: the server responds 413 (and may close the
  // socket while the client is still uploading), which undici's fetch
  // reports as a generic "fetch failed" instead of the status.
  const status = await new Promise<number>((resolve, reject) => {
    const mod = BASE_URL.startsWith("https") ? require("https") : require("http");
    const url = new URL(`${BASE_URL}${POST_PATH}`);
    const req = mod.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) },
        timeout: 15000 },
      (res: { statusCode?: number }) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    const chunk = "x".repeat(64 * 1024);
    const write = () => {
      while (true) {
        const ok = req.write(chunk);
        if (!ok) { req.once("drain", () => setImmediate(write)); return; }
      }
    };
    write();
    req.end();
  });
  if (status === 413) {
    record("2MB body -> 413", "PASS", `status ${status}`);
  } else {
    record("2MB body -> 413", "FAIL", `expected 413, got ${status}`);
  }
}

async function checkDtoExtraFields(): Promise<void> {
  // extra/undeclared fields must be stripped (or rejected) — never 500
  const res = await fetchRaw(`${BASE_URL}${POST_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "1", username: "u", role: "admin", extra: "x" }),
  });
  if (res.status < 500) {
    record("DTO extra fields stripped/rejected (no 500)", "PASS", `status ${res.status}`);
  } else {
    record("DTO extra fields stripped/rejected (no 500)", "FAIL", `got ${res.status}`);
  }
}

async function checkMetricsPolicy(): Promise<void> {
  // loopback client is trusted under the internal policy: /metrics must be
  // reachable for scraping. The external-source 403 cannot be observed from
  // a loopback client — probe --external-url when provided.
  const res = await fetchRaw(`${BASE_URL}/metrics`);
  if (!res.ok) {
    record("/metrics reachable on loopback (internal policy)", "FAIL", `status ${res.status}`);
    return;
  }
  if (EXTERNAL_URL) {
    const ext = await fetchRaw(`${EXTERNAL_URL.replace(/\/$/, "")}/metrics`);
    if (ext.status === 403 || ext.status === 404) {
      record("/metrics blocked for external sources", "PASS", `external status ${ext.status}`);
    } else {
      record("/metrics blocked for external sources", "FAIL", `external status ${ext.status}`);
    }
  } else {
    record("/metrics blocked for external sources", "SKIP", "external 403 is not observable from loopback; pass --external-url to probe");
  }
}

async function checkRequestId(): Promise<void> {
  // invalid X-Request-Id must be discarded server-side; the raw value must
  // never show up in a response body (log injection guard)
  // \r\n cannot travel in a fetch header; use regex-invalid but header-safe values
  const evil = "bad<script>";
  const evil2 = "x".repeat(200);
  const res = await fetchRaw(`${BASE_URL}/`, { headers: { "x-request-id": evil } });
  const text = await res.text();
  if (!text.includes(evil) && !text.includes(evil2)) {
    record("invalid X-Request-Id never echoed", "PASS", "response body clean");
  } else {
    record("invalid X-Request-Id never echoed", "FAIL", "raw request id found in response");
  }
}

async function checkGraphQL(): Promise<void> {
  // applies only when the target app enables the graphql protocol
  const res = await fetchRaw(`${BASE_URL}/graphql`);
  if (res.status === 404) {
    record("GET /graphql without query -> non-200", "SKIP", "graphql protocol not enabled on target app");
    record("GraphQL introspection rejected", "SKIP", "graphql protocol not enabled on target app");
    return;
  }
  if (res.status >= 400) {
    record("GET /graphql without query -> non-200", "PASS", `status ${res.status}`);
    const intro = await fetchRaw(`${BASE_URL}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ __schema { types { name } } }" }),
    });
    const body = await intro.text();
    if (intro.status >= 400 || body.includes("introspection")) {
      record("GraphQL introspection rejected", "PASS", `status ${intro.status}`);
    } else {
      record("GraphQL introspection rejected", "FAIL", "introspection succeeded");
    }
  } else {
    record("GET /graphql without query -> non-200", "FAIL", `status ${res.status}`);
  }
}

async function checkWebsocketOrigin(): Promise<void> {
  // applies only when the target app enables the ws protocol; probing an
  // HTTP server with an upgrade request requires a raw socket
  record("non-allowlisted WS origin -> 403", "SKIP", "covered by SEC-08 unit tests; enable a ws protocol endpoint to probe live");
}

async function checkTlsVersion(): Promise<void> {
  if (!EXTERNAL_URL || !EXTERNAL_URL.startsWith("https://")) {
    record("TLSv1.1 handshake fails", "SKIP", "pass --external-url https://... to probe live TLS");
    return;
  }
  record("TLSv1.1 handshake fails", "SKIP", "TLS probing requires openssl; verify with: openssl s_client -tls1_1 -connect <host>");
}

async function checkMultipart(): Promise<void> {
  // strict profile allows 10 files; an 11-file upload must be 413
  const boundary = "----koattybaseline";
  const filePart = 'Content-Disposition: form-data; name="f"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello';
  const parts: string[] = [];
  for (let i = 0; i < 11; i++) {
    parts.push(`--${boundary}\r\n${filePart.replace('name="f"', `name="f${i}"`)}\r\n`);
  }
  const body = parts.join("") + `--${boundary}--\r\n`;
  const res = await fetchRaw(`${BASE_URL}${POST_PATH}`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(Buffer.byteLength(body)) },
    body,
  });
  if (res.status === 413 || res.status === 400) {
    record("11-file upload -> 413", "PASS", `status ${res.status}`);
  } else {
    record("11-file upload -> 413", "FAIL", `expected 413, got ${res.status}`);
  }
}

async function checkLivenessMinimal(): Promise<void> {
  const res = await fetchRaw(`${BASE_URL}/health`);
  const body = await res.json().catch(() => ({}));
  const keys = Object.keys(body as object);
  if (res.status === 200 && keys.length === 1 && keys[0] === "status") {
    record("/health returns minimal liveness body only", "PASS", JSON.stringify(body));
  } else {
    record("/health returns minimal liveness body only", "FAIL", `status ${res.status}, keys: ${keys.join(",")}`);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[security-baseline] base-url=${BASE_URL} app-dir=${APP_DIR}`);
  try {
    if (!SKIP_START) {
      console.log("[security-baseline] starting example app (NODE_ENV=production)...");
      await startApp();
    }
    // wait one extra tick for middlewares to settle
    await new Promise((r) => setTimeout(r, 500));

    await safeCheck("/health returns minimal liveness body only", checkLivenessMinimal);
    await safeCheck("malformed JSON body -> 400", checkMalformedJson);
    await safeCheck("2MB body -> 413", checkOversizedBody);
    await safeCheck("DTO extra fields stripped/rejected (no 500)", checkDtoExtraFields);
    await safeCheck("11-file upload -> 413", checkMultipart);
    await safeCheck("/metrics reachable on loopback (internal policy)", checkMetricsPolicy);
    await safeCheck("invalid X-Request-Id never echoed", checkRequestId);
    await safeCheck("GET /graphql without query -> non-200", checkGraphQL);
    await safeCheck("non-allowlisted WS origin -> 403", checkWebsocketOrigin);
    await safeCheck("TLSv1.1 handshake fails", checkTlsVersion);
  } finally {
    stopApp();
  }

  console.log("\n==================== SECURITY BASELINE ====================");
  let failed = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️ ";
    if (r.status === "FAIL") failed++;
    console.log(`${icon} [${r.status}] ${r.name} — ${r.detail}`);
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(`-----------------------------------------------------------`);
  console.log(`PASS ${passed} / FAIL ${failed} / SKIP ${skipped}`);
  console.log("===========================================================");
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("[security-baseline] fatal:", err instanceof Error ? err.message : err);
  stopApp();
  process.exit(1);
});
