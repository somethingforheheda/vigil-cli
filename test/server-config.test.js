"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const server_config_1 = require("../hooks/src/server-config");
const tempDirs = [];
function makeTempHome() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-server-config-"));
    tempDirs.push(tmpDir);
    return tmpDir;
}
(0, node_test_1.afterEach)(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});
(0, node_test_1.describe)("server-config helpers", () => {
    (0, node_test_1.it)("clearRuntimeConfig removes runtime.json when present", () => {
        const tmpHome = makeTempHome();
        const runtimeDir = path.join(tmpHome, ".vigilcli");
        fs.mkdirSync(runtimeDir, { recursive: true });
        const runtimePath = path.join(runtimeDir, "runtime.json");
        fs.writeFileSync(runtimePath, JSON.stringify({ app: "vigil-cli", port: 23333 }));
        node_assert_1.default.strictEqual((0, server_config_1.clearRuntimeConfig)(runtimePath), true);
        node_assert_1.default.strictEqual(fs.existsSync(runtimePath), false);
    });
    (0, node_test_1.it)("splitPortCandidates prioritizes preferred and runtime ports", () => {
        const result = (0, server_config_1.splitPortCandidates)(23335, { runtimePort: 23334 });
        node_assert_1.default.deepStrictEqual(result.direct, [23335, 23334]);
        node_assert_1.default.ok(result.fallback.includes(23333));
        node_assert_1.default.ok(!result.fallback.includes(23334));
        node_assert_1.default.ok(!result.fallback.includes(23335));
    });
    (0, node_test_1.it)("probePort recognizes signed VigilCLI responses", async () => {
        await new Promise((resolve, reject) => {
            (0, server_config_1.probePort)(23337, 100, (ok) => {
                try {
                    node_assert_1.default.strictEqual(ok, true);
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            }, {
                httpGet(_options, onResponse) {
                    const res = {
                        headers: { "x-vigilcli-server": "vigil-cli" },
                        setEncoding() { },
                        on(event, handler) {
                            if (event === "data")
                                handler("");
                            if (event === "end")
                                handler();
                        },
                    };
                    onResponse(res);
                    return { on() { }, destroy() { } };
                },
            });
        });
    });
    (0, node_test_1.it)("resolveNodeBin returns bare node on Windows", () => {
        node_assert_1.default.strictEqual((0, server_config_1.resolveNodeBin)({ platform: "win32" }), "node");
    });
    (0, node_test_1.it)("resolveNodeBin returns process.execPath when not in Electron", () => {
        node_assert_1.default.strictEqual((0, server_config_1.resolveNodeBin)({ platform: "darwin", isElectron: false, execPath: "/opt/homebrew/bin/node" }), "/opt/homebrew/bin/node");
    });
    (0, node_test_1.it)("resolveNodeBin finds node from well-known paths in Electron", () => {
        node_assert_1.default.strictEqual((0, server_config_1.resolveNodeBin)({
            platform: "darwin", isElectron: true, homeDir: "/Users/tester",
            accessSync(candidate) {
                if (candidate === "/opt/homebrew/bin/node")
                    return;
                throw new Error("ENOENT");
            },
        }), "/opt/homebrew/bin/node");
    });
    (0, node_test_1.it)("resolveNodeBin returns null when nothing is found", () => {
        node_assert_1.default.strictEqual((0, server_config_1.resolveNodeBin)({
            platform: "darwin", isElectron: true, homeDir: "/Users/tester",
            accessSync() { throw new Error("ENOENT"); },
            execFileSync() { throw new Error("not found"); },
        }), null);
    });
    (0, node_test_1.it)("postStateToRunningServer probes fallback ports before posting", async () => {
        const probes = [];
        const posts = [];
        await new Promise((resolve, reject) => {
            (0, server_config_1.postStateToRunningServer)(JSON.stringify({ state: "idle" }), {
                timeoutMs: 50, preferredPort: 23335, runtimePort: 23334,
                probePort(port, _t, cb) { probes.push(port); cb(port === 23336); },
                postStateToPort(port, _p, _t, cb) { posts.push(port); cb(port === 23336, port); },
            }, (ok, port) => {
                try {
                    node_assert_1.default.strictEqual(ok, true);
                    node_assert_1.default.strictEqual(port, 23336);
                    node_assert_1.default.deepStrictEqual(posts, [23335, 23334, 23336]);
                    node_assert_1.default.deepStrictEqual(probes, [23333, 23336]);
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    });
});
