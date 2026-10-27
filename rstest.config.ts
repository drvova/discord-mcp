import { defineConfig } from "@rstest/core";

export default defineConfig({
    include: ["src/**/*.test.ts"],
    testEnvironment: "node",
    // Dependencies are externalized and loaded by Node at runtime, so resolve
    // them the way Node does (no bundler-only `module`/`esnext` builds).
    resolve: {
        conditionNames: ["node", "import", "require", "default"],
        mainFields: ["main"],
    },
});
