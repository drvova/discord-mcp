// Redaction for anything that records a URL (logs, labels, trace spans).
// Kept dependency-free so telemetry can load it before instrumented modules.

// Discord puts webhook and interaction tokens in the request path.
export function redactDiscordTokenPath(path: string): string {
    return path
        .replace(/(\/webhooks\/\d+\/)[^/?#]+/g, "$1:token")
        .replace(/(\/interactions\/\d+\/)[^/?#]+/g, "$1:token");
}

// A URL safe to log or label: no credentials, no query string, no path tokens.
export function redactUrl(url: URL | string): string {
    const parsed = typeof url === "string" ? new URL(url) : new URL(url.href);
    parsed.username = "";
    parsed.password = "";
    const hadQuery = parsed.search.length > 0;
    parsed.search = "";
    parsed.hash = "";
    return `${redactDiscordTokenPath(parsed.href)}${hadQuery ? "?<redacted>" : ""}`;
}
