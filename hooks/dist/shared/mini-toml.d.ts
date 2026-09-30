export type TomlValue = string | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
    [key: string]: TomlValue;
}
/** Parse a TOML document. Throws on syntax this reader does not understand. */
export declare function parseToml(text: string): TomlTable;
/** Walk a key path through nested tables; undefined when absent. */
export declare function getTomlPath(table: TomlTable | null | undefined, keyPath: string[]): TomlValue | undefined;
