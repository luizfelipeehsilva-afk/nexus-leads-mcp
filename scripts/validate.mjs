import { readFile, access } from "node:fs/promises";

const required = [
  "package.json",
  "wrangler.jsonc",
  "src/index.ts",
  "src/mcp-server.ts",
  "src/auth-handler.ts",
  "src/oauth-utils.ts",
  "migrations/0017_mcp_bridge.sql",
  "README.md",
];

for (const file of required) await access(new URL(`../${file}`, import.meta.url));
const source = await readFile(new URL("../src/mcp-server.ts", import.meta.url), "utf8");
const tools = [...source.matchAll(/"(nexus_[a-z_]+)"/g)].map((match) => match[1]);
const unique = [...new Set(tools)];
if (unique.length < 10) throw new Error(`Poucas ferramentas MCP encontradas: ${unique.length}`);
console.log(`Validação estrutural aprovada. Ferramentas detectadas: ${unique.length}`);
console.log(unique.join("\n"));
