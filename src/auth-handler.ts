import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { AuthProps, Env } from "./types";
import {
  base64UrlDecode,
  base64UrlEncode,
  clearCookie,
  consumeOAuthState,
  cookieValue,
  escapeHtml,
  exchangeGithubCode,
  githubAuthorizeUrl,
  githubIdentity,
  secureCookie,
  storeOAuthState,
} from "./oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();
const CSRF_COOKIE = "__Host-NEXUS-MCP-CSRF";

function allowedUsers(env: Env): Set<string> {
  return new Set(
    String(env.ALLOWED_GITHUB_USERS || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function page(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#090b10;color:#f5f7fb;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(620px,100%);background:#11151d;border:1px solid #273040;border-radius:22px;padding:30px;box-shadow:0 24px 80px #0008}.brand{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8ca0bf}.muted{color:#a9b4c7;line-height:1.65}h1{font-size:clamp(28px,6vw,44px);margin:12px 0}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;border-radius:12px;border:0;background:#f5f7fb;color:#0b0d12;font-weight:800;padding:0 18px;text-decoration:none;cursor:pointer}.secondary{background:#202735;color:#e7edf8;margin-right:10px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}code{background:#080a0e;border:1px solid #252d3a;padding:3px 7px;border-radius:7px}ul{color:#c1cada;line-height:1.75}</style></head><body><main class="card">${body}</main></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

app.get("/", (c) => page("Nexus MCP", `<div class="brand">Nexus Leads AI</div><h1>MCP Bridge</h1><p class="muted">Conector privado entre o Nexus Leads AI e clientes compatíveis com Model Context Protocol.</p><p class="muted">Endpoint MCP: <code>${escapeHtml(new URL("/mcp", c.req.url).href)}</code></p><div class="actions"><a class="button" href="/health">Verificar saúde</a></div>`));

app.get("/health", (c) => c.json({ ok: true, service: "nexus-leads-mcp", version: "1.0.0", mcp: new URL("/mcp", c.req.url).href }));

app.get("/privacy", () => page("Privacidade", `<div class="brand">Nexus MCP</div><h1>Privacidade</h1><p class="muted">Este conector é privado e utiliza autenticação GitHub. Ele acessa somente os dados do banco Nexus autorizados pelo proprietário. Tokens do GitHub não são armazenados como dados de negócio. Chamadas de ferramentas podem ser registradas para auditoria técnica.</p>`));

app.get("/terms", () => page("Termos", `<div class="brand">Nexus MCP</div><h1>Termos de uso</h1><p class="muted">Uso restrito aos usuários GitHub permitidos na configuração do Worker. Ações de escrita exigem confirmação e os dados de teste são identificados para permitir limpeza segura.</p>`));

app.get("/authorize", async (c) => {
  let requestInfo: AuthRequest;
  try {
    requestInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch {
    return c.text("Solicitação OAuth inválida.", 400);
  }
  if (!requestInfo.clientId) return c.text("Cliente OAuth inválido.", 400);
  const client = await c.env.OAUTH_PROVIDER.lookupClient(requestInfo.clientId);
  const csrf = crypto.randomUUID();
  const encoded = base64UrlEncode(JSON.stringify(requestInfo));
  const response = page("Autorizar Nexus MCP", `<div class="brand">Nexus Leads AI</div><h1>Autorizar conexão</h1><p class="muted"><strong>${escapeHtml(client?.clientName || "Cliente MCP")}</strong> solicita acesso ao Nexus.</p><ul><li>Consultar CRM, tarefas, propostas, financeiro e projetos.</li><li>Executar diagnósticos técnicos.</li><li>Criar somente cenários de teste identificados, mediante confirmação.</li></ul><form method="post" action="/authorize"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="request" value="${escapeHtml(encoded)}"><div class="actions"><a class="button secondary" href="/">Cancelar</a><button type="submit">Continuar com GitHub</button></div></form>`);
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", secureCookie(CSRF_COOKIE, csrf, 600));
  return new Response(response.body, { status: response.status, headers });
});

app.post("/authorize", async (c) => {
  const form = await c.req.raw.formData();
  const csrfForm = String(form.get("csrf") || "");
  const csrfCookie = cookieValue(c.req.raw, CSRF_COOKIE) || "";
  if (!csrfForm || !csrfCookie || csrfForm !== csrfCookie) return c.text("Validação CSRF falhou.", 400);

  let requestInfo: AuthRequest;
  try {
    requestInfo = JSON.parse(base64UrlDecode(String(form.get("request") || ""))) as AuthRequest;
  } catch {
    return c.text("Solicitação OAuth inválida.", 400);
  }

  const { state, bindingCookie } = await storeOAuthState(c.env.OAUTH_KV, requestInfo);
  const headers = new Headers({ Location: githubAuthorizeUrl(c.req.raw, c.env.GITHUB_CLIENT_ID, state) });
  headers.append("Set-Cookie", clearCookie(CSRF_COOKIE));
  headers.append("Set-Cookie", bindingCookie);
  return new Response(null, { status: 302, headers });
});

app.get("/callback", async (c) => {
  try {
    const requestInfo = await consumeOAuthState(c.req.raw, c.env.OAUTH_KV);
    const githubToken = await exchangeGithubCode(c.req.raw, c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET);
    const identity = await githubIdentity(githubToken);
    const allowed = allowedUsers(c.env);
    if (!allowed.has(identity.login.toLowerCase())) {
      return page("Acesso negado", `<div class="brand">Nexus MCP</div><h1>Acesso não autorizado</h1><p class="muted">O usuário GitHub <strong>${escapeHtml(identity.login)}</strong> não está na lista permitida.</p>`);
    }

    const props: AuthProps = identity;
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: requestInfo,
      userId: identity.login,
      metadata: { label: identity.name || identity.login },
      scope: requestInfo.scope,
      props,
    });
    const headers = new Headers({ Location: redirectTo });
    headers.append("Set-Cookie", clearCookie("__Host-NEXUS-OAUTH-STATE"));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return page("Falha na autenticação", `<div class="brand">Nexus MCP</div><h1>Não foi possível conectar</h1><p class="muted">${escapeHtml(error instanceof Error ? error.message : "Erro desconhecido")}</p><div class="actions"><a class="button" href="/">Recomeçar</a></div>`);
  }
});

export { app as AuthHandler };
