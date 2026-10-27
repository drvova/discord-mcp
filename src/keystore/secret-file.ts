import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Secret files are handled the way OpenSSH handles private keys: owned by the
// current user, readable by nobody else (refused otherwise), written with mode
// 600 inside a mode 700 directory.

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
    if (env.DISCORD_MCP_CONFIG_DIR) {
        return resolve(env.DISCORD_MCP_CONFIG_DIR);
    }
    return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "discord-mcp");
}

export function ensurePrivateDir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const mode = statSync(dir).mode & 0o777;
    if (mode & 0o077) {
        chmodSync(dir, 0o700);
    }
}

function currentUid(): number | undefined {
    return typeof process.getuid === "function" ? process.getuid() : undefined;
}

// Throws unless `path` is a regular file owned by this user and inaccessible to
// group and others (`writableOnly` relaxes that to "not writable by others",
// which is what OpenSSH asks of known_hosts).
export function assertPrivateFile(
    path: string,
    options: { writableOnly?: boolean } = {},
): void {
    const stats = statSync(path);
    if (!stats.isFile()) {
        throw new Error(`${path} is not a regular file.`);
    }
    const uid = currentUid();
    if (uid !== undefined && stats.uid !== uid && stats.uid !== 0) {
        throw new Error(`Bad owner for ${path}: it must be owned by you (uid ${uid}).`);
    }
    const mode = stats.mode & 0o777;
    const tooOpen = options.writableOnly ? mode & 0o022 : mode & 0o077;
    if (tooOpen) {
        const octal = mode.toString(8).padStart(4, "0");
        throw new Error(
            [
                "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
                "@         WARNING: UNPROTECTED SECRET FILE!               @",
                "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
                `Permissions ${octal} for '${path}' are too open.`,
                options.writableOnly
                    ? "It must not be writable by group or others."
                    : "It is required that your secret files are NOT accessible by others.",
                `Fix it with: chmod ${options.writableOnly ? "644" : "600"} '${path}'`,
            ].join("\n"),
        );
    }
}

export function readPrivateFile(
    path: string,
    options: { writableOnly?: boolean } = {},
): string {
    assertPrivateFile(path, options);
    return readFileSync(path, "utf8");
}

// Atomic write with mode 600; the directory is created (or tightened) to 700.
export function writePrivateFile(path: string, contents: string): void {
    ensurePrivateDir(dirname(path));
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, contents, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
}

export function privateFileExists(path: string): boolean {
    return existsSync(path);
}
