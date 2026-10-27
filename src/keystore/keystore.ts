import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
} from "node:crypto";
import { join } from "node:path";
import type { IdentityMode } from "../identity/local-encrypted-identity-store.js";
import {
    configDir,
    privateFileExists,
    readPrivateFile,
    writePrivateFile,
} from "./secret-file.js";

// Discord identities encrypted under a passphrase, like a passphrase-protected
// SSH private key: scrypt derives the key, AES-256-GCM encrypts and
// authenticates, and the file is mode 600. Only the agent (or the CLI, while
// you edit it) ever holds the decrypted tokens.

export type KeystoreIdentity = {
    id: string;
    mode: IdentityMode;
    token: string;
    addedAt: string;
};

type Envelope = {
    format: "discord-mcp-identities";
    version: 1;
    kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
    cipher: "aes-256-gcm";
    iv: string;
    tag: string;
    data: string;
};

const KDF = { N: 2 ** 15, r: 8, p: 1 };
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function defaultKeystorePath(env: NodeJS.ProcessEnv = process.env): string {
    return env.DISCORD_MCP_IDENTITIES_FILE || join(configDir(env), "identities");
}

export function validateIdentityId(id: string): void {
    if (!ID_PATTERN.test(id)) {
        throw new Error(
            `Invalid identity id '${id}': use letters, digits, '.', '_' or '-' (max 64).`,
        );
    }
}

function deriveKey(passphrase: string, salt: Buffer, kdf = KDF): Buffer {
    return scryptSync(passphrase.normalize("NFKC"), salt, 32, {
        N: kdf.N,
        r: kdf.r,
        p: kdf.p,
        maxmem: 256 * kdf.N * kdf.r,
    });
}

export function encryptIdentities(
    identities: KeystoreIdentity[],
    passphrase: string,
): string {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    const data = Buffer.concat([
        cipher.update(JSON.stringify({ identities }), "utf8"),
        cipher.final(),
    ]);
    const envelope: Envelope = {
        format: "discord-mcp-identities",
        version: 1,
        kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
        cipher: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function decryptIdentities(contents: string, passphrase: string): KeystoreIdentity[] {
    let envelope: Envelope;
    try {
        envelope = JSON.parse(contents) as Envelope;
    } catch {
        throw new Error("Identities file is not valid JSON.");
    }
    if (envelope.format !== "discord-mcp-identities" || envelope.version !== 1) {
        throw new Error("Unsupported identities file format.");
    }
    const { N, r, p, salt } = envelope.kdf;
    const key = deriveKey(passphrase, Buffer.from(salt, "base64"), { N, r, p });
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    try {
        const plain = Buffer.concat([
            decipher.update(Buffer.from(envelope.data, "base64")),
            decipher.final(),
        ]).toString("utf8");
        return (JSON.parse(plain) as { identities: KeystoreIdentity[] }).identities;
    } catch (error) {
        throw new Error("Incorrect passphrase (or the identities file was modified).", {
            cause: error,
        });
    }
}

export class Keystore {
    constructor(readonly path: string = defaultKeystorePath()) {}

    exists(): boolean {
        return privateFileExists(this.path);
    }

    load(passphrase: string): KeystoreIdentity[] {
        if (!this.exists()) {
            return [];
        }
        return decryptIdentities(readPrivateFile(this.path), passphrase);
    }

    save(identities: KeystoreIdentity[], passphrase: string): void {
        writePrivateFile(this.path, encryptIdentities(identities, passphrase));
    }
}
