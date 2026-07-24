# Instalação passo a passo — Nexus MCP

## Antes de começar

O MCP será um Worker separado chamado `nexus-leads-mcp`. Ele compartilhará o banco `nexus-leads-db`, mas não substituirá o Worker do site.

## 1. Executar a migration no D1

No Cloudflare Dashboard:

1. Abra **Workers & Pages**.
2. Entre em **D1 SQL Database**.
3. Abra `nexus-leads-db`.
4. Abra o Console.
5. Copie todo o conteúdo de `migrations/0017_mcp_bridge.sql`.
6. Execute uma única vez.

Confirme:

```sql
SELECT migration_key, applied_at
FROM app_migrations
WHERE migration_key='0017_mcp_bridge_v1';
```

Confira as tabelas:

```sql
SELECT name
FROM sqlite_master
WHERE type='table'
AND name IN ('mcp_audit_log','mcp_test_runs')
ORDER BY name;
```

## 2. Criar o KV do OAuth

Pelo Cloudflare Dashboard:

1. Vá em **Storage & Databases**.
2. Abra **KV**.
3. Crie um namespace chamado `nexus-mcp-oauth`.
4. Copie o ID do namespace.
5. Abra `wrangler.jsonc`.
6. Troque `SUBSTITUA_PELO_ID_DO_KV` pelo ID real.

## 3. Criar o GitHub OAuth App

No GitHub pelo navegador:

1. Abra sua foto de perfil.
2. Entre em **Settings**.
3. Abra **Developer settings**.
4. Entre em **OAuth Apps**.
5. Clique em **New OAuth App**.
6. Preencha:

```text
Application name:
Nexus Leads MCP

Homepage URL:
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev

Authorization callback URL:
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev/callback
```

7. Crie o aplicativo.
8. Copie o **Client ID**.
9. Gere um **Client secret** e copie-o imediatamente.

## 4. Criar o Worker separado

Crie um repositório GitHub separado chamado:

```text
nexus-leads-mcp
```

Envie o conteúdo deste pacote para a raiz do repositório.

No Cloudflare:

1. Abra **Workers & Pages**.
2. Clique em **Create**.
3. Escolha importar o repositório `nexus-leads-mcp`.
4. Confirme o nome do Worker: `nexus-leads-mcp`.
5. O comando de deploy deve usar Wrangler.

## 5. Cadastrar os secrets

No Worker `nexus-leads-mcp`, abra **Settings → Variables and Secrets**.

Cadastre como **Secret**:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
COOKIE_ENCRYPTION_KEY
NEXUS_APP_TOKEN
```

Valores:

- `GITHUB_CLIENT_ID`: Client ID do OAuth App.
- `GITHUB_CLIENT_SECRET`: Client secret do OAuth App.
- `COOKIE_ENCRYPTION_KEY`: uma sequência aleatória longa, com pelo menos 64 caracteres.
- `NEXUS_APP_TOKEN`: o mesmo valor do secret `APP_TOKEN` utilizado pelo Worker principal do Nexus.

Não coloque esses valores no GitHub.

## 6. Usuário GitHub permitido

O arquivo `wrangler.jsonc` já contém:

```text
luizfelipeehsilva-afk
```

Somente esse usuário poderá concluir a autenticação. Para incluir outro usuário, separe por vírgula:

```text
usuario1,usuario2
```

## 7. Fazer o deploy

Depois do deploy, abra:

```text
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev/health
```

O resultado esperado contém:

```json
{
  "ok": true,
  "service": "nexus-leads-mcp",
  "version": "1.0.0"
}
```

Abrir `/mcp` diretamente no navegador não mostra uma página normal; esse endereço espera mensagens do protocolo MCP.

## 8. Testar com MCP Inspector

Em um computador com Node.js:

```bash
npx @modelcontextprotocol/inspector@latest
```

No Inspector, informe:

```text
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev/mcp
```

Escolha transporte HTTP/Streamable HTTP e conecte. O navegador abrirá o login GitHub e a autorização.

Primeiros testes:

```text
nexus_system_health
nexus_run_full_audit
nexus_test_api_endpoints
```

## 9. Conectar ao ChatGPT

Use a URL:

```text
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev/mcp
```

No ChatGPT web, em uma conta/workspace com Developer Mode disponível:

1. Ative o Developer Mode.
2. Crie um app/conector MCP personalizado.
3. Cole a URL `/mcp`.
4. Autorize com o GitHub.
5. Abra uma nova conversa e selecione o app Nexus.

## 10. Teste seguro completo

Peça ao cliente MCP:

```text
Execute a auditoria completa do Nexus e teste os endpoints, sem alterar dados.
```

Depois:

```text
Crie um cenário de teste MCP completo. Confirmação: true.
```

Ao finalizar:

```text
Remova somente os dados de teste MCP. Confirmação: DELETE_MCP_TEST_DATA.
```
