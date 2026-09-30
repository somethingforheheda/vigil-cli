const vscode = require("vscode");
const http = require("http");

// Port range for VigilCLI terminal-focus extension instances.
// Each editor window gets its own extension host → each needs a unique port.
// The VigilCLI main process (src/focus.ts) POSTs to every port in the range;
// only the window that owns a terminal with a matching PID responds 200.
const PORT_BASE = 23456;
const PORT_RANGE = 5; // support up to 5 concurrent editor windows
const MAX_BODY_BYTES = 16 * 1024; // a PID chain is tiny; refuse anything larger
const MAX_PIDS = 64;
const PROCESS_ID_TIMEOUT_MS = 500;

let server = null;
let boundPort = null;
let disposed = false;

function sanitizePids(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const n = typeof v === "string" ? Number(v) : v;
    if (Number.isInteger(n) && n > 0 && n <= 0x7fffffff && !out.includes(n)) out.push(n);
    if (out.length >= MAX_PIDS) break;
  }
  return out;
}

// terminal.processId can stay pending for terminals that never started a
// process (e.g. pseudoterminals); don't let one of those block the lookup.
function processIdWithTimeout(terminal) {
  return Promise.race([
    Promise.resolve(terminal.processId).catch(() => undefined),
    new Promise((resolve) => setTimeout(() => resolve(undefined), PROCESS_ID_TIMEOUT_MS)),
  ]);
}

async function focusTerminalByPids(pids) {
  for (const terminal of vscode.window.terminals) {
    const termPid = await processIdWithTimeout(terminal);
    if (termPid && pids.includes(termPid)) {
      terminal.show(true); // true = preserveFocus, switch tab without stealing focus
      return true;
    }
  }
  return false;
}

function send(res, status, text) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text || "");
}

function handleRequest(req, res) {
  if (req.method !== "POST" || req.url !== "/focus-tab") return send(res, 404);

  // Only the VigilCLI main process (Node http client) should call this.
  // Browsers always attach an Origin header to cross-site POSTs, and cannot
  // send application/json cross-origin without a CORS preflight we never
  // answer — rejecting both keeps web pages from driving the editor.
  if (req.headers.origin) return send(res, 403, "forbidden");
  const ctype = String(req.headers["content-type"] || "");
  if (!ctype.toLowerCase().startsWith("application/json")) return send(res, 415, "expected application/json");

  let size = 0;
  const chunks = [];
  let aborted = false;
  req.on("data", (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      send(res, 413, "payload too large");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => { aborted = true; });
  req.on("end", () => {
    if (aborted) return;
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, "bad json");
    }
    const pids = sanitizePids(data && data.pids);
    if (!pids.length) return send(res, 400, "no pids");
    focusTerminalByPids(pids).then(
      (found) => send(res, found ? 200 : 404, found ? "ok" : "not found"),
      (err) => send(res, 500, String((err && err.message) || err)),
    );
  });
}

function tryListen(port, maxPort) {
  if (disposed) return;
  if (port > maxPort) {
    console.log("VigilCLI terminal-focus: all ports in use, HTTP server disabled");
    return;
  }

  const srv = http.createServer(handleRequest);
  srv.requestTimeout = 5000;
  srv.headersTimeout = 5000;

  srv.on("error", (err) => {
    if (boundPort === null) {
      // Failed to bind (typically EADDRINUSE: another editor window owns this
      // port). Close this instance and try the next port in the range.
      if (server === srv) server = null;
      try { srv.close(); } catch { /* not listening */ }
      if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
        tryListen(port + 1, maxPort);
      } else {
        console.warn("VigilCLI terminal-focus: HTTP server error:", err && err.message);
      }
    } else {
      console.warn("VigilCLI terminal-focus: HTTP server error:", err && err.message);
    }
  });

  server = srv;
  // Loopback only — never expose this endpoint to the network.
  srv.listen(port, "127.0.0.1", () => {
    if (disposed) { srv.close(); return; }
    boundPort = port;
    console.log(`VigilCLI terminal-focus: listening on 127.0.0.1:${port}`);
  });
}

function activate(context) {
  disposed = false;
  tryListen(PORT_BASE, PORT_BASE + PORT_RANGE - 1);
  context.subscriptions.push({ dispose: stopServer });

  // URI handler kept as fallback for manual testing:
  // vscode://vigilcli.vigilcli-terminal-focus?pids=1234,5678
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        const params = new URLSearchParams(uri.query);
        const raw = params.get("pids") || params.get("pid") || "";
        const pids = sanitizePids(raw.split(","));
        if (pids.length) await focusTerminalByPids(pids);
      },
    })
  );
}

function stopServer() {
  disposed = true;
  if (server) {
    try { server.close(); } catch { /* already closed */ }
    server = null;
  }
  boundPort = null;
}

function deactivate() {
  stopServer();
}

module.exports = { activate, deactivate };
