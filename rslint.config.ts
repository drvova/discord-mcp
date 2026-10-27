import { defineConfig, globalIgnores, js, nodePlugin, rstestPlugin, ts } from "@rslint/core";

export default defineConfig([
    globalIgnores(["dist/**", "node_modules/**"]),
    js.configs.recommended,
    ...ts.configs.recommended,
    nodePlugin.configs.recommendedModule,
    {
        settings: {
            // Sources compile 1:1 to dist/ (see rslib.config.ts), which is what `bin` points at.
            node: { convertPath: { "src/**/*.ts": ["^src/(.+)\\.ts$", "dist/$1.js"] } },
        },
    },
    {
        // Tests and tool configs run from the repo, so dev dependencies are fine there.
        files: ["src/**/*.test.ts", "*.config.ts"],
        rules: { "node/no-unpublished-import": "off" },
    },
    {
        files: ["src/**/*.test.ts"],
        ...rstestPlugin.configs.recommended,
    },
    {
        // The server entry point exits on fatal startup errors and signals.
        files: ["src/index.ts"],
        rules: { "node/no-process-exit": "off" },
    },
]);
