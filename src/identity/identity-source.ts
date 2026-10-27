import type { IdentityMode } from "./local-encrypted-identity-store.js";

// Where the server gets Discord identities from. In direct mode the records
// hold real tokens; with the agent they hold `agent:<id>` placeholders and the
// agent keeps the tokens.
export type IdentityRecord = { id: string; mode: IdentityMode; token: string };

export interface IdentitySource {
    readonly managedByAgent?: boolean;
    getIdentity(id: string): IdentityRecord | undefined;
    listIdentityIds(): string[];
    upsertIdentity(id: string, mode: IdentityMode, token: string): void;
    refresh?(): Promise<void>;
}
