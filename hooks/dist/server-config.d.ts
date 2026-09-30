import * as http from "http";
export declare const VIGILCLI_SERVER_ID = "vigil-cli";
export declare const VIGILCLI_SERVER_HEADER = "x-vigilcli-server";
export declare const DEFAULT_SERVER_PORT = 23333;
export declare const SERVER_PORT_COUNT = 5;
export declare const SERVER_PORTS: number[];
export declare const STATE_PATH = "/state";
export declare const PERMISSION_PATH = "/permission";
export declare const RUNTIME_CONFIG_PATH: string;
/** Query marker appended to the PermissionRequest hook URL so we can recognise our own entries. */
export declare const PERMISSION_APP_QUERY = "app=vigilcli";
export declare const AUTH_HEADER = "x-vigilcli-token";
export declare const AUTH_TOKEN_PATH: string;
/** Request header: fresh random nonce (32 bytes, hex) chosen by the permission hook. */
export declare const NONCE_HEADER = "x-vigilcli-nonce";
/** Response header: computeProof(token, nonce), set by the server on every /permission response. */
export declare const PROOF_HEADER = "x-vigilcli-proof";
/** hex HMAC-SHA256(key = token, message = nonce). */
export declare function computeProof(token: string, nonce: string): string;
/** Constant-time check of a PROOF_HEADER value. Never throws. */
export declare function verifyProof(token: string, nonce: string, proof: unknown): boolean;
/** Env override for remote hosts (SSH tunnel) that have no local ~/.vigilcli/auth-token. */
export declare const AUTH_TOKEN_ENV = "VIGILCLI_TOKEN";
/**
 * Read the auth token; returns null when missing or malformed. Never throws.
 * Without an explicit filePath, a non-empty process.env.VIGILCLI_TOKEN wins over the file.
 */
export declare function readAuthToken(filePath?: string): string | null;
/**
 * Return the existing valid auth token, or create a new one
 * (32 random bytes, hex; dir 0700, file 0600, atomic write).
 */
export declare function getOrCreateAuthToken(filePath?: string): string;
export declare function readHostPrefix(): string;
export declare function readRuntimeConfig(): {
    port: number;
} | null;
export declare function readRuntimePort(): number | null;
export declare function writeRuntimeConfig(port: number): boolean;
export declare function clearRuntimeConfig(filePath?: string): boolean;
export declare function getPortCandidates(preferredPort?: number | number[] | null, options?: {
    runtimePort?: number | null;
}): number[];
export declare function splitPortCandidates(preferredPort?: number | number[] | null, options?: {
    runtimePort?: number | null;
}): {
    direct: number[];
    fallback: number[];
    all: number[];
};
export declare function buildPermissionUrl(port: number): string;
/**
 * True if a PermissionRequest http-hook URL belongs to VigilCLI:
 * either the tagged URL (`?app=vigilcli`) or the exact legacy untagged URL.
 * Other tools' `/permission` hooks are never matched.
 */
export declare function isVigilCLIPermissionUrl(url: unknown): boolean;
type ProbeCallback = (ok: boolean) => void;
type PostCallback = (posted: boolean, port: number) => void;
interface ProbeOptions {
    httpGet?: typeof http.get;
}
interface PostOptions {
    httpRequest?: typeof http.request;
    /** Auth token sent as AUTH_HEADER. undefined → readAuthToken(); null → no header. */
    authToken?: string | null;
}
export declare function probePort(port: number, timeoutMs: number, callback: ProbeCallback, options?: ProbeOptions): void;
export declare function postStateToPort(port: number, payload: string, timeoutMs: number, callback: PostCallback, options?: PostOptions): void;
interface PostStateOptions {
    timeoutMs?: number;
    preferredPort?: number | number[] | null;
    runtimePort?: number | null;
    probePort?: (port: number, t: number, cb: ProbeCallback, opts: ProbeOptions) => void;
    postStateToPort?: (port: number, p: string, t: number, cb: PostCallback, opts: PostOptions) => void;
    /** Test override: injected into inner probePort calls */
    httpGet?: ProbeOptions["httpGet"];
    /** Test override: injected into inner postStateToPort calls */
    httpRequest?: PostOptions["httpRequest"];
    /** Auth token override. undefined → readAuthToken() (read once per call); null → no header. */
    authToken?: string | null;
}
export declare function postStateToRunningServer(body: string | object, options: PostStateOptions, callback: (posted: boolean, port: number | null) => void): void;
type ExecFileAsync = (file: string, args: string[], options: object) => Promise<{
    stdout: string | Buffer;
}>;
interface NodeBinOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    execFileSync?: (file: string, args: string[], options: object) => string;
    accessSync?: (path: string, mode?: number) => void;
    execPath?: string;
    isElectron?: boolean;
}
interface NodeBinAsyncOptions extends Omit<NodeBinOptions, "execFileSync" | "accessSync"> {
    execFile?: ExecFileAsync;
    access?: (path: string, mode?: number) => Promise<void>;
}
/** Test helper: forget cached node binary lookups. */
export declare function clearNodeBinCache(): void;
/**
 * Synchronously resolve an absolute `node` binary for hook commands.
 * Can block for several seconds (login-shell probe) — inside Electron prefer
 * resolveNodeBinAsync() first; its result is cached and reused here.
 */
export declare function resolveNodeBin(options?: NodeBinOptions): string | null;
/**
 * Non-blocking variant of resolveNodeBin() (uses async fs.access + execFile).
 * The default lookup is cached module-wide and shared with resolveNodeBin().
 */
export declare function resolveNodeBinAsync(options?: NodeBinAsyncOptions): Promise<string | null>;
/** promisified child_process.execFile (lazy-required so hook bundles stay cheap to load). */
export declare function defaultExecFileAsync(): ExecFileAsync;
export {};
