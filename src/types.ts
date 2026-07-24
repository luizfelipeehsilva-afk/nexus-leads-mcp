export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  NEXUS_MCP: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  NEXUS_APP_TOKEN: string;
  NEXUS_APP_URL: string;
  ALLOWED_GITHUB_USERS: string;
}

export type AuthProps = {
  login: string;
  name: string;
  email: string;
};
