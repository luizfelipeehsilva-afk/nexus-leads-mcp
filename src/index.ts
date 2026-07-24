import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { AuthHandler } from "./auth-handler";
import { NexusMCP } from "./mcp-server";

export { NexusMCP };

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: NexusMCP.serve("/mcp", { binding: "NEXUS_MCP" }),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  defaultHandler: AuthHandler as any,
});
