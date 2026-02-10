import { hc } from "hono/client";
import type { AppType } from "../../../src/http-app.js";

export const api = hc<AppType>("");
