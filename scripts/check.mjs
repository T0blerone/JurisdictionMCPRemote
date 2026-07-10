// Smoke test: connect to the local Worker over MCP Streamable HTTP and call both
// tools. Usage: node scripts/check.mjs  (with `wrangler dev` running on :8787)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL || "http://localhost:8787/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "smoke-check", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const fresh = await client.callTool({
  name: "check_cache_freshness",
  arguments: { confirmed_date: "2026-01-02", as_of: "2026-05-01" },
});
console.log("freshness:", fresh.content[0].text);

for (const [label, address] of [
  ["denver", "1629 York St, Denver, CO 80206"],
  ["vail", "107 Rockledge Rd, Vail, CO 81657"],
]) {
  const r = await client.callTool({ name: "resolve_address", arguments: { address } });
  const o = JSON.parse(r.content[0].text);
  console.log(`${label}: status=${o.status} code=${o.code_dashless} rate=${o.total_rate} reason=${o.reason ?? ""}`);
}

await client.close();
