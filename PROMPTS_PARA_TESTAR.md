# Prompts recomendados

## Diagnóstico geral

```text
Use o Nexus MCP para executar uma auditoria completa do sistema. Mostre problemas críticos, tabelas ou colunas ausentes, migrations aplicadas e um plano de correção priorizado. Não altere dados.
```

## Testar API

```text
Teste todos os endpoints principais do Nexus pelo MCP e organize os resultados por sucesso, lentidão, erro de autorização e erro interno. Não altere dados.
```

## Qualidade do CRM

```text
Analise o Command Center e os leads do Nexus. Identifique leads sem telefone, sem follow-up, parados e possíveis prioridades comerciais. Não faça alterações.
```

## Cenário completo de homologação

```text
Crie um cenário completo de teste MCP chamado Homologação Nexus. Eu confirmo a criação. Depois consulte o lead criado e confirme se Agenda, Propostas, Financeiro e Projetos foram vinculados corretamente.
```

## Limpeza

```text
Exclua somente os dados criados pelo cenário MCP. A frase de confirmação é DELETE_MCP_TEST_DATA. Depois execute uma auditoria para confirmar que nenhum dado real foi removido.
```
