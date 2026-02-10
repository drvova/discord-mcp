import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig(({ command }) => ({
    plugins: [svelte()],
    // In dev we keep root base to avoid "/app" public-base redirect warnings.
    // In production build we emit assets for Hono mount path "/app/".
    base: command === "serve" ? "/" : "/app/",
    server: {
        fs: {
            allow: [".."],
        },
        proxy: {
            "/api": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            "/auth": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            "/oauth": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            "/sse": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            "/message": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            "/health": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
        },
    },
}));
