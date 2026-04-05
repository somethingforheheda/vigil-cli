"use strict";
// src/log-rotate.ts — Append to a log file, truncating when it exceeds maxBytes
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_BYTES = void 0;
exports.rotatedAppend = rotatedAppend;
const fs = __importStar(require("fs"));
exports.DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB
/**
 * Append `line` to `filePath`. If the file exceeds `maxBytes` after the write,
 * truncate it to keep roughly the newest half (cut at a newline boundary).
 */
function rotatedAppend(filePath, line, maxBytes = exports.DEFAULT_MAX_BYTES) {
    fs.appendFileSync(filePath, line);
    let size;
    try {
        size = fs.statSync(filePath).size;
    }
    catch {
        return;
    }
    if (size <= maxBytes)
        return;
    let buf;
    try {
        buf = fs.readFileSync(filePath);
    }
    catch {
        return;
    }
    const half = Math.floor(buf.length / 2);
    const nl = buf.indexOf(0x0a, half); // first \n after midpoint
    if (nl === -1 || nl >= buf.length - 1)
        return;
    fs.writeFileSync(filePath, buf.slice(nl + 1));
}
