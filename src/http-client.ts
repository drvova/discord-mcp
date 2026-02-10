import { hc } from "hono/client";
import type { AppType } from "./http-app.js";

export function createHttpClient(baseUrl: string) {
    return hc<AppType>(baseUrl);
}

export type DiscordMcpHttpClient = ReturnType<typeof createHttpClient>;
