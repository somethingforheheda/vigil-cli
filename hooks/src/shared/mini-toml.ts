// hooks/src/shared/mini-toml.ts — tiny, read-only TOML reader for ~/.codex/config.toml
// Bundled into installer dist/ output by esbuild (zero external deps at runtime).
//
// Supports what we need to inspect Codex config: tables, array-of-tables, dotted / quoted keys,
// basic & literal (multi-line) strings, booleans, arrays and inline tables. Numbers, dates and
// other bare scalars are returned as their raw text. Throws on malformed input — callers catch.

export type TomlValue = string | boolean | TomlValue[] | TomlTable;
export interface TomlTable { [key: string]: TomlValue }

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): TomlTable {
    const root: TomlTable = {};
    let current = root;
    for (;;) {
      this.skipBlank();
      if (this.i >= this.s.length) return root;
      const ch = this.s[this.i];
      if (ch === "[") {
        const isArray = this.s[this.i + 1] === "[";
        this.i += isArray ? 2 : 1;
        this.skipInline();
        const keyPath = this.parseKeyPath();
        this.skipInline();
        this.expect(isArray ? "]]" : "]");
        current = isArray ? this.appendArrayTable(root, keyPath) : this.getTable(root, keyPath);
      } else {
        const keyPath = this.parseKeyPath();
        this.skipInline();
        this.expect("=");
        this.skipInline();
        const value = this.parseValue();
        this.assign(current, keyPath, value);
      }
      this.endOfLine();
    }
  }

  private getTable(root: TomlTable, keyPath: string[]): TomlTable {
    let t = root;
    for (const key of keyPath) {
      let next = t[key];
      if (Array.isArray(next)) next = next[next.length - 1];
      if (next === undefined) { next = {}; t[key] = next; }
      if (typeof next !== "object" || Array.isArray(next)) throw new Error(`not a table: ${key}`);
      t = next as TomlTable;
    }
    return t;
  }

  private appendArrayTable(root: TomlTable, keyPath: string[]): TomlTable {
    const parent = this.getTable(root, keyPath.slice(0, -1));
    const last = keyPath[keyPath.length - 1];
    let arr = parent[last];
    if (arr === undefined) { arr = []; parent[last] = arr; }
    if (!Array.isArray(arr)) throw new Error(`not an array: ${last}`);
    const table: TomlTable = {};
    arr.push(table);
    return table;
  }

  private assign(table: TomlTable, keyPath: string[], value: TomlValue): void {
    const parent = this.getTable(table, keyPath.slice(0, -1));
    parent[keyPath[keyPath.length - 1]] = value;
  }

  private expect(token: string): void {
    if (!this.s.startsWith(token, this.i)) throw new Error(`expected ${token} at ${this.i}`);
    this.i += token.length;
  }

  /** Spaces/tabs only. */
  private skipInline(): void {
    while (this.i < this.s.length && (this.s[this.i] === " " || this.s[this.i] === "\t")) this.i++;
  }

  private skipComment(): void {
    if (this.s[this.i] !== "#") return;
    while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
  }

  /** Whitespace, newlines and comments. */
  private skipBlank(): void {
    for (;;) {
      this.skipInline();
      if (this.s[this.i] === "#") { this.skipComment(); continue; }
      if (this.s[this.i] === "\n" || this.s[this.i] === "\r") { this.i++; continue; }
      return;
    }
  }

  private endOfLine(): void {
    this.skipInline();
    this.skipComment();
    if (this.i >= this.s.length) return;
    if (this.s[this.i] === "\r") this.i++;
    if (this.s[this.i] !== "\n") throw new Error(`expected newline at ${this.i}`);
    this.i++;
  }

  private parseKeyPath(): string[] {
    const keys = [this.parseKey()];
    for (;;) {
      this.skipInline();
      if (this.s[this.i] !== ".") return keys;
      this.i++;
      this.skipInline();
      keys.push(this.parseKey());
    }
  }

  private parseKey(): string {
    const ch = this.s[this.i];
    if (ch === '"') return this.parseBasicString();
    if (ch === "'") return this.parseLiteralString();
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z0-9_-]/.test(this.s[this.i])) this.i++;
    if (this.i === start) throw new Error(`invalid key at ${this.i}`);
    return this.s.slice(start, this.i);
  }

  private parseValue(): TomlValue {
    const s = this.s;
    if (s.startsWith('"""', this.i)) return this.parseMultilineBasic();
    if (s.startsWith("'''", this.i)) return this.parseMultilineLiteral();
    const ch = s[this.i];
    if (ch === '"') return this.parseBasicString();
    if (ch === "'") return this.parseLiteralString();
    if (ch === "[") return this.parseArray();
    if (ch === "{") return this.parseInlineTable();
    const start = this.i;
    while (this.i < s.length && !/[,\]}\s#]/.test(s[this.i])) this.i++;
    const raw = s.slice(start, this.i);
    if (!raw) throw new Error(`invalid value at ${start}`);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }

  private parseArray(): TomlValue[] {
    this.expect("[");
    const out: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.s[this.i] === "]") { this.i++; return out; }
      out.push(this.parseValue());
      this.skipBlank();
      if (this.s[this.i] === ",") { this.i++; continue; }
      this.expect("]");
      return out;
    }
  }

  private parseInlineTable(): TomlTable {
    this.expect("{");
    const table: TomlTable = {};
    this.skipBlank();
    if (this.s[this.i] === "}") { this.i++; return table; }
    for (;;) {
      this.skipBlank();
      const keyPath = this.parseKeyPath();
      this.skipInline();
      this.expect("=");
      this.skipInline();
      this.assign(table, keyPath, this.parseValue());
      this.skipBlank();
      if (this.s[this.i] === ",") { this.i++; continue; }
      this.expect("}");
      return table;
    }
  }

  private parseEscape(): string {
    const c = this.s[this.i++];
    switch (c) {
      case "b": return "\b";
      case "t": return "\t";
      case "n": return "\n";
      case "f": return "\f";
      case "r": return "\r";
      case "e": return "\x1b";
      case '"': return '"';
      case "\\": return "\\";
      case "u": case "U": {
        const len = c === "u" ? 4 : 8;
        const hex = this.s.slice(this.i, this.i + len);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== len) throw new Error(`bad escape at ${this.i}`);
        this.i += len;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      default: throw new Error(`bad escape at ${this.i}`);
    }
  }

  private parseBasicString(): string {
    this.expect('"');
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '"') return out;
      if (c === "\n") break;
      out += c === "\\" ? this.parseEscape() : c;
    }
    throw new Error("unterminated string");
  }

  private parseLiteralString(): string {
    this.expect("'");
    const end = this.s.indexOf("'", this.i);
    const nl = this.s.indexOf("\n", this.i);
    if (end === -1 || (nl !== -1 && nl < end)) throw new Error("unterminated string");
    const out = this.s.slice(this.i, end);
    this.i = end + 1;
    return out;
  }

  private skipLeadingNewline(): void {
    if (this.s[this.i] === "\r") this.i++;
    if (this.s[this.i] === "\n") this.i++;
  }

  private parseMultilineBasic(): string {
    this.expect('"""');
    this.skipLeadingNewline();
    let out = "";
    while (this.i < this.s.length) {
      if (this.s.startsWith('"""', this.i)) {
        this.i += 3;
        // Up to two extra quotes may sit right before the closing delimiter
        for (let k = 0; k < 2 && this.s[this.i] === '"'; k++) { out += '"'; this.i++; }
        return out;
      }
      const c = this.s[this.i++];
      if (c !== "\\") { out += c; continue; }
      // Line-ending backslash trims following whitespace/newlines
      let j = this.i;
      while (this.s[j] === " " || this.s[j] === "\t") j++;
      if (this.s[j] === "\n" || this.s[j] === "\r") {
        while (/[\s]/.test(this.s[j] ?? "")) j++;
        this.i = j;
        continue;
      }
      out += this.parseEscape();
    }
    throw new Error("unterminated string");
  }

  private parseMultilineLiteral(): string {
    this.expect("'''");
    this.skipLeadingNewline();
    const end = this.s.indexOf("'''", this.i);
    if (end === -1) throw new Error("unterminated string");
    let stop = end;
    while (this.s[stop + 3] === "'") stop++;
    const out = this.s.slice(this.i, stop);
    this.i = stop + 3;
    return out;
  }
}

/** Parse a TOML document. Throws on syntax this reader does not understand. */
export function parseToml(text: string): TomlTable {
  return new Parser(text.replace(/^﻿/, "")).parse();
}

/** Walk a key path through nested tables; undefined when absent. */
export function getTomlPath(table: TomlTable | null | undefined, keyPath: string[]): TomlValue | undefined {
  let cur: TomlValue | undefined = table ?? undefined;
  for (const key of keyPath) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as TomlTable)[key];
  }
  return cur;
}
