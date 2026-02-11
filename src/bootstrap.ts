import "dotenv/config";
import { initializeTelemetry } from "./observability/telemetry.js";

await initializeTelemetry();
await import("./index.js");
