import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { decryptIdentities, encryptIdentities, Keystore, validateIdentityId } from "./keystore.js";
import { assertPrivateFile, readPrivateFile, writePrivateFile } from "./secret-file.js";

function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-secrets-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const IDENTITY = { id: "ops-bot", mode: "bot" as const, token: "TOKEN-abc.def", addedAt: "2026-10-27T00:00:00.000Z" };

test("secret files are written 600 inside a 700 directory", () => {
    const path = join(tempDir(), "nested", "secret");
    writePrivateFile(path, "hello");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    expect(readPrivateFile(path)).toBe("hello");
});

test("secret files readable by others are refused, like SSH private keys", () => {
    const path = join(tempDir(), "secret");
    writeFileSync(path, "x", { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(() => assertPrivateFile(path)).toThrow(/UNPROTECTED SECRET FILE[\s\S]*Permissions 0644[\s\S]*chmod 600/);
    chmodSync(path, 0o640);
    expect(() => readPrivateFile(path)).toThrow(/too open/);
    chmodSync(path, 0o600);
    expect(() => assertPrivateFile(path)).not.toThrow();

    // known_hosts-style files only need to be unwritable by others.
    chmodSync(path, 0o644);
    expect(() => assertPrivateFile(path, { writableOnly: true })).not.toThrow();
    chmodSync(path, 0o664);
    expect(() => assertPrivateFile(path, { writableOnly: true })).toThrow(/chmod 644/);
});

test("identities round-trip under the right passphrase only", () => {
    const sealed = encryptIdentities([IDENTITY], "correct horse");
    expect(sealed).not.toContain("TOKEN-abc");
    expect(decryptIdentities(sealed, "correct horse")).toEqual([IDENTITY]);
    expect(() => decryptIdentities(sealed, "wrong horse")).toThrow(/Incorrect passphrase/);

    // Each save uses a fresh salt and IV.
    expect(encryptIdentities([IDENTITY], "correct horse")).not.toBe(sealed);
});

test("a modified identities file fails authentication", () => {
    const envelope = JSON.parse(encryptIdentities([IDENTITY], "pw")) as { data: string };
    const data = Buffer.from(envelope.data, "base64");
    data[0] ^= 0xff;
    envelope.data = data.toString("base64");
    expect(() => decryptIdentities(JSON.stringify(envelope), "pw")).toThrow(/modified/);
});

test("the keystore file is private and passphrase-protected", () => {
    const store = new Keystore(join(tempDir(), "identities"));
    expect(store.load("anything")).toEqual([]);
    store.save([IDENTITY], "pw");
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(store.path, "utf8")).not.toContain(IDENTITY.token);
    expect(store.load("pw")).toEqual([IDENTITY]);

    chmodSync(store.path, 0o644);
    expect(() => store.load("pw")).toThrow(/UNPROTECTED/);
});

test("identity ids are restricted to safe names", () => {
    expect(() => validateIdentityId("default-bot")).not.toThrow();
    expect(() => validateIdentityId("ops.bot_2")).not.toThrow();
    expect(() => validateIdentityId("../etc")).toThrow(/Invalid identity id/);
    expect(() => validateIdentityId("")).toThrow(/Invalid identity id/);
});
