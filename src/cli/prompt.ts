import { readPrivateFile } from "../keystore/secret-file.js";

// Reads secrets the way ssh/ssh-add do: from the terminal with echo off, or
// (for unattended use) from a file that must be private. Never from argv,
// which every user on the machine can see in `ps`.

export async function readHidden(prompt: string): Promise<string> {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
        throw new Error(`${prompt.trim()} needs a terminal (or use a private file, see --help).`);
    }
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    return await new Promise<string>((resolveInput, rejectInput) => {
        let value = "";
        const finish = (error?: Error) => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stderr.write("\n");
            if (error) {
                rejectInput(error);
            } else {
                resolveInput(value);
            }
        };
        const onData = (chunk: string) => {
            for (const char of chunk) {
                if (char === "\r" || char === "\n" || char === "\u0004") {
                    finish();
                    return;
                }
                if (char === "\u0003") {
                    finish(new Error("Cancelled."));
                    return;
                }
                if (char === "\u007f" || char === "\b") {
                    value = value.slice(0, -1);
                } else {
                    value += char;
                }
            }
        };
        stdin.on("data", onData);
    });
}

async function readStdin(): Promise<string> {
    let data = "";
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data.replace(/\r?\n$/, "");
}

// The passphrase that protects the identities file.
export async function readPassphrase(
    prompt = "Enter passphrase for identities: ",
    env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
    if (env.DISCORD_MCP_PASSPHRASE_FILE) {
        return readPrivateFile(env.DISCORD_MCP_PASSPHRASE_FILE).replace(/\r?\n$/, "");
    }
    return readHidden(prompt);
}

// A new passphrase, typed twice like ssh-keygen.
export async function readNewPassphrase(env: NodeJS.ProcessEnv = process.env): Promise<string> {
    if (env.DISCORD_MCP_PASSPHRASE_FILE) {
        return readPassphrase(undefined, env);
    }
    const first = await readHidden("Enter new passphrase (empty for no passphrase): ");
    const second = await readHidden("Enter same passphrase again: ");
    if (first !== second) {
        throw new Error("Passphrases do not match.");
    }
    return first;
}

// A Discord token for `identity add`: from a private file, from stdin when it
// is piped, or typed at a hidden prompt.
export async function readToken(tokenFile: string | undefined): Promise<string> {
    if (tokenFile) {
        return readPrivateFile(tokenFile).trim();
    }
    if (!process.stdin.isTTY) {
        return (await readStdin()).trim();
    }
    return (await readHidden("Discord token: ")).trim();
}
