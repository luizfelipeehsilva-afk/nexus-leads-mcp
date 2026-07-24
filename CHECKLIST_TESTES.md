# Checklist de testes MCP

## Infraestrutura

- [ ] `/health` responde 200.
- [ ] OAuth abre a tela de consentimento.
- [ ] Login GitHub autorizado conclui.
- [ ] Usuário GitHub fora da allowlist é bloqueado.
- [ ] MCP Inspector lista as ferramentas.

## Leitura

- [ ] `nexus_system_health` encontra as tabelas.
- [ ] `nexus_command_center` retorna indicadores.
- [ ] `nexus_list_leads` respeita limite e filtros.
- [ ] `nexus_get_lead` retorna relacionamentos.
- [ ] Tarefas, propostas, pagamentos e projetos carregam.
- [ ] `nexus_run_full_audit` identifica migrations/colunas.
- [ ] `nexus_test_api_endpoints` testa o Worker principal.

## Escrita controlada

- [ ] Cenário não é criado com `confirm=false`.
- [ ] Cenário é criado com `confirm=true`.
- [ ] Lead aparece no CRM com origem `MCP Test`.
- [ ] Tarefa aparece na Agenda.
- [ ] Proposta aparece em Propostas.
- [ ] Cobrança aparece no Financeiro.
- [ ] Projeto aparece em Projetos.
- [ ] Limpeza falha com frase incorreta.
- [ ] Limpeza remove apenas registros `mcp_test_`/`MCP Test`.

## Auditoria e segurança

- [ ] Chamadas aparecem em `mcp_audit_log`.
- [ ] Secrets não aparecem nos resultados.
- [ ] GitHub token não é salvo no D1.
- [ ] `ALLOWED_GITHUB_USERS` contém apenas usuários autorizados.
