import dotenv from "dotenv";

// Imported first by the entry points so .env is loaded before any module reads
// the environment. quiet: dotenv would otherwise print a banner to stdout,
// which carries the MCP protocol in stdio mode.
dotenv.config({ quiet: true });
