# Nexus Leads AI — MCP Bridge V1

Servidor MCP remoto e privado para conectar o Nexus Leads AI a clientes compatíveis com Model Context Protocol.

## Arquitetura

```text
ChatGPT / MCP Inspector
        ↓ OAuth 2.1
GitHub OAuth + lista de usuários permitidos
        ↓
Cloudflare Worker: nexus-leads-mcp
        ↓
D1 nexus-leads-db + API do Nexus principal
```

O MCP fica em um Worker separado para evitar que uma falha no conector derrube o site principal.

## Ferramentas incluídas

### Somente leitura

- `nexus_system_health`
- `nexus_command_center`
- `nexus_list_leads`
- `nexus_get_lead`
- `nexus_list_tasks`
- `nexus_list_proposals`
- `nexus_list_payments`
- `nexus_list_projects`
- `nexus_run_full_audit`
- `nexus_test_api_endpoints`

### Testes controlados

- `nexus_seed_test_scenario`: cria um cenário identificado com prefixo `mcp_test_`.
- `nexus_cleanup_test_data`: remove somente os registros de teste MCP e exige confirmação literal.

Todas as chamadas tentam registrar auditoria em `mcp_audit_log`.

## Segurança

- OAuth 2.1 intermediado pelo Worker.
- Login pelo GitHub.
- Lista permitida em `ALLOWED_GITHUB_USERS`.
- Nenhuma chave do Nexus é enviada ao modelo.
- O token GitHub é usado somente para confirmar identidade e não é salvo como dado de negócio.
- Ferramentas de escrita e exclusão são marcadas corretamente no MCP.
- O servidor MCP usa um Durable Object próprio e o mesmo D1 do Nexus.

## Instalação resumida

Siga `GUIA_INSTALACAO_PASSO_A_PASSO.md`.

1. Execute `migrations/0017_mcp_bridge.sql` no D1.
2. Crie um KV chamado `OAUTH_KV`.
3. Cole o ID do KV em `wrangler.jsonc`.
4. Crie um GitHub OAuth App.
5. Cadastre os quatro secrets.
6. Publique este Worker separado.
7. Teste no MCP Inspector.
8. Em um plano do ChatGPT com Developer Mode, adicione a URL HTTPS terminada em `/mcp`.

## Endpoint esperado

```text
https://nexus-leads-mcp.luizfelipeehsilva.workers.dev/mcp
```
