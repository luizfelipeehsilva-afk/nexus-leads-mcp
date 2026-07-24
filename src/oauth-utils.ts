import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

const encoder = new TextEncoder();

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function secureCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name: string): string {
  return secureCookie(name, "", 0);
}

export async function storeOAuthState(
  kv: KVNamespace,
  requestInfo: AuthRequest,
): Promise<{ state: string; bindingCookie: string }> {
  const state = crypto.randomUUID();
  await kv.put(`oauth_state:${state}`, JSON.stringify(requestInfo), { expirationTtl: 600 });
  const binding = await sha256(state);
  return {
    state,
    bindingCookie: secureCookie("__Host-NEXUS-OAUTH-STATE", binding, 600),
  };
}

export async function consumeOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<AuthRequest> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (!state) throw new Error("Estado OAuth ausente.");

  const stored = await kv.get(`oauth_state:${state}`);
  if (!stored) throw new Error("Estado OAuth inválido ou expirado.");

  const expectedBinding = await sha256(state);
  const suppliedBinding = cookieValue(request, "__Host-NEXUS-OAUTH-STATE");
  if (!suppliedBinding || suppliedBinding !== expectedBinding) {
    throw new Error("Sessão OAuth inválida. Reinicie a conexão.");
  }

  await kv.delete(`oauth_state:${state}`);
  return JSON.parse(stored) as AuthRequest;
}

export function githubAuthorizeUrl(request: Request, clientId: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", new URL("/callback", request.url).href);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.href;
}

export async function exchangeGithubCode(
  request: Request,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) throw new Error("Código de autorização do GitHub ausente.");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Nexus-Leads-MCP",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: new URL("/callback", request.url).href,
    }),
  });

  const data = await response.json() as Record<string, unknown>;
  const token = String(data.access_token || "");
  if (!response.ok || !token) {
    throw new Error(`Falha ao autenticar no GitHub: ${String(data.error_description || data.error || response.status)}`);
  }
  return token;
}

export async function githubIdentity(token: string): Promise<{ login: string; name: string; email: string }> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Nexus-Leads-MCP",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  const user = await userResponse.json() as Record<string, unknown>;
  if (!userResponse.ok || !user.login) throw new Error("Não foi possível validar o usuário do GitHub.");

  let email = String(user.email || "");
  if (!email) {
    const emailResponse = await fetch("https://api.github.com/user/emails", { headers });
    if (emailResponse.ok) {
      const emails = await emailResponse.json() as Array<Record<string, unknown>>;
      const primary = emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified);
      email = String(primary?.email || "");
    }
  }

  return {
    login: String(user.login),
    name: String(user.name || user.login),
    email,
  };
}
