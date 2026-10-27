import { defineConfig } from "@rslib/core";

// Bundleless ESM build: each source module compiles to its own file in dist/,
// keeping relative paths (and import.meta.url) the same as in src/.
export default defineConfig({
    lib: [
        {
            format: "esm",
            syntax: "es2022",
            bundle: false,
            dts: false,
        },
    ],
    source: {
        entry: {
            index: ["./src/**/*.ts", "!./src/**/*.test.ts"],
        },
    },
    output: {
        target: "node",
        sourceMap: true,
    },
});
