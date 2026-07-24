# Notas de segurança

1. Não publique `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY` ou `NEXUS_APP_TOKEN` no GitHub.
2. Mantenha `ALLOWED_GITHUB_USERS` restrito.
3. Use um Worker separado para o MCP.
4. Não transforme ferramentas de teste em exclusões genéricas.
5. Revise `mcp_audit_log` periodicamente.
6. Revogue o Client secret do GitHub caso ele seja exposto.
7. Troque `NEXUS_APP_TOKEN` caso apareça em prints, commits ou conversas.
8. Antes de liberar outros usuários, implemente permissões por função e workspace.
