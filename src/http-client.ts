import { hc } from "hono/client";
import type { ClientRequestOptions } from "hono/client";
import type { AppType } from "./http-app.js";

export function createHttpClient(
    baseUrl: string,
    options?: ClientRequestOptions,
) {
    return hc<AppType>(baseUrl, options);
}

export type DiscordMcpHttpClient = ReturnType<typeof createHttpClient>;
