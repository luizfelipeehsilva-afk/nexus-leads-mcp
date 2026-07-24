import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import type { AuthProps, Env } from "./types";

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const READ_SECURITY = [{ type: "oauth2", scopes: ["nexus.read"] }];
const WRITE_SECURITY = [{ type: "oauth2", scopes: ["nexus.write"] }];

const asText = (data: unknown) => JSON.stringify(data, null, 2);
const limitedText = (value: unknown, max = 1000) => String(value ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: asText(data) }],
    structuredContent: data,
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

async function tableExists(env: Env, table: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row?.name);
}

async function columnsFor(env: Env, table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<Record<string, unknown>>();
  return (rows.results || []).map((row) => String(row.name || ""));
}

async function audit(
  env: Env,
  actor: string,
  tool: string,
  status: "success" | "error",
  durationMs: number,
  input: unknown,
  summary: unknown,
) {
  try {
    await env.DB.prepare(`INSERT INTO mcp_audit_log(id,github_login,tool_name,status,duration_ms,input_json,result_summary)
      VALUES(?,?,?,?,?,?,?)`)
      .bind(
        `mcp_log_${crypto.randomUUID()}`,
        actor,
        tool,
        status,
        durationMs,
        JSON.stringify(input).slice(0, 4000),
        JSON.stringify(summary).slice(0, 4000),
      ).run();
  } catch {
    // O MCP continua funcionando mesmo se a migration de auditoria ainda não tiver sido executada.
  }
}

export class NexusMCP extends McpAgent<Env, Record<string, never>, AuthProps> {
  server = new McpServer({
    name: "Nexus Leads AI MCP",
    version: "1.0.0",
  });

  private async runTool<T>(name: string, input: unknown, action: () => Promise<T>) {
    const started = Date.now();
    try {
      const data = await action();
      await audit(this.env, this.props.login, name, "success", Date.now() - started, input, data);
      return result(data as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      await audit(this.env, this.props.login, name, "error", Date.now() - started, input, { error: message });
      return errorResult(message);
    }
  }

  async init() {
    this.server.registerTool(
      "nexus_system_health",
      {
        description: "Use para verificar se o MCP, o banco D1 e as migrations essenciais do Nexus estão disponíveis.",
        inputSchema: {},
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async () => this.runTool("nexus_system_health", {}, async () => {
        const requiredTables = [
          "leads", "lead_activities", "proposals", "commercial_tasks", "payments", "projects",
          "campaigns", "integrations", "audit_events", "app_migrations", "mcp_audit_log",
        ];
        const rows = await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<Record<string, unknown>>();
        const tables = (rows.results || []).map((row) => String(row.name));
        const migrations = await this.env.DB.prepare("SELECT migration_key,applied_at FROM app_migrations ORDER BY applied_at DESC LIMIT 30").all<Record<string, unknown>>();
        return {
          ok: requiredTables.every((table) => tables.includes(table)),
          service: "nexus-leads-mcp",
          version: "1.0.0",
          authenticatedGithubUser: this.props.login,
          generatedAt: nowIso(),
          missingTables: requiredTables.filter((table) => !tables.includes(table)),
          tableCount: tables.length,
          migrations: migrations.results || [],
        };
      }),
    );

    this.server.registerTool(
      "nexus_command_center",
      {
        description: "Use para obter um resumo executivo do CRM: leads, tarefas, propostas, recebimentos, projetos e principais riscos.",
        inputSchema: {},
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async () => this.runTool("nexus_command_center", {}, async () => {
        const [leads, tasks, proposals, payments, projects] = await Promise.all([
          this.env.DB.prepare(`SELECT COUNT(*) total,
            SUM(CASE WHEN COALESCE(phone,'')='' THEN 1 ELSE 0 END) without_phone,
            SUM(CASE WHEN COALESCE(next_contact_at,'')='' AND stage NOT IN ('Fechado','Perdido') THEN 1 ELSE 0 END) without_followup,
            SUM(CASE WHEN datetime(COALESCE(updated_at,created_at)) < datetime('now','-14 days') AND stage NOT IN ('Fechado','Perdido') THEN 1 ELSE 0 END) stale,
            COALESCE(SUM(CASE WHEN stage='Fechado' THEN COALESCE(NULLIF(closed_value,0),estimated_value,0) ELSE 0 END),0) won_value
            FROM leads WHERE COALESCE(archived,0)=0`).first<Record<string, unknown>>(),
          this.env.DB.prepare(`SELECT COUNT(*) total,
            SUM(CASE WHEN status!='Concluída' AND datetime(due_at)<datetime('now') THEN 1 ELSE 0 END) overdue,
            SUM(CASE WHEN status!='Concluída' AND date(due_at)=date('now') THEN 1 ELSE 0 END) today
            FROM commercial_tasks`).first<Record<string, unknown>>(),
          this.env.DB.prepare(`SELECT COUNT(*) total,
            SUM(CASE WHEN status='Rascunho' THEN 1 ELSE 0 END) drafts,
            SUM(CASE WHEN valid_until IS NOT NULL AND date(valid_until)<date('now') AND status NOT IN ('Aceita','Recusada') THEN 1 ELSE 0 END) expired,
            COALESCE(SUM(CASE WHEN status='Aceita' THEN amount ELSE 0 END),0) accepted_value FROM proposals`).first<Record<string, unknown>>(),
          this.env.DB.prepare(`SELECT COUNT(*) total,
            COALESCE(SUM(MAX(0,amount-amount_paid)),0) receivable,
            SUM(CASE WHEN status!='Pago' AND due_date IS NOT NULL AND date(due_date)<date('now') THEN 1 ELSE 0 END) overdue FROM payments`).first<Record<string, unknown>>(),
          this.env.DB.prepare(`SELECT COUNT(*) total,
            SUM(CASE WHEN status NOT IN ('Concluído','Pausado') THEN 1 ELSE 0 END) active,
            SUM(CASE WHEN due_date IS NOT NULL AND date(due_date)<date('now') AND status!='Concluído' THEN 1 ELSE 0 END) overdue FROM projects`).first<Record<string, unknown>>(),
        ]);
        const issues = {
          leadsWithoutPhone: Number(leads?.without_phone || 0),
          leadsWithoutFollowup: Number(leads?.without_followup || 0),
          staleLeads: Number(leads?.stale || 0),
          overdueTasks: Number(tasks?.overdue || 0),
          expiredProposals: Number(proposals?.expired || 0),
          overduePayments: Number(payments?.overdue || 0),
          overdueProjects: Number(projects?.overdue || 0),
        };
        const penalty = Object.values(issues).reduce((sum, value) => sum + value * 3, 0);
        return {
          generatedAt: nowIso(),
          healthScore: Math.max(0, Math.min(100, 100 - penalty)),
          summary: {
            activeLeads: Number(leads?.total || 0),
            tasksToday: Number(tasks?.today || 0),
            proposals: Number(proposals?.total || 0),
            receivable: Number(payments?.receivable || 0),
            activeProjects: Number(projects?.active || 0),
            wonValue: Number(leads?.won_value || 0),
            acceptedProposalValue: Number(proposals?.accepted_value || 0),
          },
          issues,
        };
      }),
    );

    this.server.registerTool(
      "nexus_list_leads",
      {
        description: "Use para localizar e listar leads do Nexus com filtros. Retorna no máximo 50 registros por chamada.",
        inputSchema: {
          query: z.string().max(120).optional().describe("Nome, telefone, cidade ou nicho."),
          stage: z.string().max(40).optional().describe("Etapa exata do pipeline."),
          city: z.string().max(80).optional(),
          niche: z.string().max(80).optional(),
          minScore: z.number().min(0).max(100).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_list_leads", input, async () => {
        const clauses = ["COALESCE(archived,0)=0"];
        const values: unknown[] = [];
        if (input.query) {
          clauses.push("(lower(name) LIKE ? OR lower(COALESCE(phone,'')) LIKE ? OR lower(city) LIKE ? OR lower(niche) LIKE ?)");
          const like = `%${String(input.query).toLowerCase()}%`;
          values.push(like, like, like, like);
        }
        if (input.stage) { clauses.push("stage=?"); values.push(input.stage); }
        if (input.city) { clauses.push("lower(city) LIKE ?"); values.push(`%${String(input.city).toLowerCase()}%`); }
        if (input.niche) { clauses.push("lower(niche) LIKE ?"); values.push(`%${String(input.niche).toLowerCase()}%`); }
        if (input.minScore !== undefined) { clauses.push("score>=?"); values.push(Number(input.minScore)); }
        const limit = Math.min(50, Math.max(1, Number(input.limit || 20)));
        const rows = await this.env.DB.prepare(`SELECT id,name,niche,city,phone,website,presence,score,priority,stage,
          contact_name,email,estimated_value,closed_value,next_contact_at,last_contact_at,source,updated_at
          FROM leads WHERE ${clauses.join(" AND ")} ORDER BY favorite DESC,score DESC,updated_at DESC LIMIT ?`)
          .bind(...values, limit).all<Record<string, unknown>>();
        return { totalReturned: rows.results?.length || 0, leads: rows.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_get_lead",
      {
        description: "Use para consultar um lead específico e sua linha do tempo, propostas, tarefas, pagamentos e projetos.",
        inputSchema: { leadId: z.string().min(1).max(160) },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_get_lead", input, async () => {
        const lead = await this.env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(input.leadId).first<Record<string, unknown>>();
        if (!lead) throw new Error("Lead não encontrado.");
        const [activities, proposals, tasks, payments, projects] = await Promise.all([
          this.env.DB.prepare("SELECT id,activity_type,description,created_at FROM lead_activities WHERE lead_id=? ORDER BY created_at DESC LIMIT 100").bind(input.leadId).all(),
          this.env.DB.prepare("SELECT * FROM proposals WHERE lead_id=? ORDER BY created_at DESC LIMIT 30").bind(input.leadId).all(),
          this.env.DB.prepare("SELECT * FROM commercial_tasks WHERE lead_id=? ORDER BY due_at DESC LIMIT 50").bind(input.leadId).all(),
          this.env.DB.prepare("SELECT * FROM payments WHERE lead_id=? ORDER BY created_at DESC LIMIT 50").bind(input.leadId).all(),
          this.env.DB.prepare("SELECT * FROM projects WHERE lead_id=? ORDER BY updated_at DESC LIMIT 30").bind(input.leadId).all(),
        ]);
        return { lead, activities: activities.results || [], proposals: proposals.results || [], tasks: tasks.results || [], payments: payments.results || [], projects: projects.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_list_tasks",
      {
        description: "Use para listar tarefas e follow-ups por status e período.",
        inputSchema: {
          status: z.string().max(40).optional(),
          dueFrom: z.string().max(30).optional().describe("Data ou datetime ISO inicial."),
          dueTo: z.string().max(30).optional().describe("Data ou datetime ISO final."),
          limit: z.number().int().min(1).max(100).default(30),
        },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_list_tasks", input, async () => {
        const clauses = ["1=1"];
        const values: unknown[] = [];
        if (input.status) { clauses.push("t.status=?"); values.push(input.status); }
        if (input.dueFrom) { clauses.push("datetime(t.due_at)>=datetime(?)"); values.push(input.dueFrom); }
        if (input.dueTo) { clauses.push("datetime(t.due_at)<=datetime(?)"); values.push(input.dueTo); }
        const rows = await this.env.DB.prepare(`SELECT t.*,l.name lead_name,l.phone lead_phone FROM commercial_tasks t
          LEFT JOIN leads l ON l.id=t.lead_id WHERE ${clauses.join(" AND ")} ORDER BY datetime(t.due_at) ASC LIMIT ?`)
          .bind(...values, Math.min(100, Number(input.limit || 30))).all();
        return { tasks: rows.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_list_proposals",
      {
        description: "Use para listar propostas comerciais e seus clientes.",
        inputSchema: { status: z.string().max(40).optional(), limit: z.number().int().min(1).max(100).default(30) },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_list_proposals", input, async () => {
        const rows = await this.env.DB.prepare(`SELECT p.*,l.name lead_name,l.phone lead_phone FROM proposals p
          LEFT JOIN leads l ON l.id=p.lead_id WHERE (?='' OR p.status=?) ORDER BY p.updated_at DESC LIMIT ?`)
          .bind(String(input.status || ""), String(input.status || ""), Math.min(100, Number(input.limit || 30))).all();
        return { proposals: rows.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_list_payments",
      {
        description: "Use para listar cobranças, pagamentos e valores pendentes.",
        inputSchema: { status: z.string().max(40).optional(), limit: z.number().int().min(1).max(100).default(30) },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_list_payments", input, async () => {
        const rows = await this.env.DB.prepare(`SELECT py.*,l.name lead_name,p.proposal_number FROM payments py
          LEFT JOIN leads l ON l.id=py.lead_id LEFT JOIN proposals p ON p.id=py.proposal_id
          WHERE (?='' OR py.status=?) ORDER BY COALESCE(py.due_date,py.created_at) DESC LIMIT ?`)
          .bind(String(input.status || ""), String(input.status || ""), Math.min(100, Number(input.limit || 30))).all();
        return { payments: rows.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_list_projects",
      {
        description: "Use para listar projetos, entregas, progresso e prazos.",
        inputSchema: { status: z.string().max(40).optional(), limit: z.number().int().min(1).max(100).default(30) },
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_list_projects", input, async () => {
        const rows = await this.env.DB.prepare(`SELECT pr.*,l.name lead_name FROM projects pr LEFT JOIN leads l ON l.id=pr.lead_id
          WHERE (?='' OR pr.status=?) ORDER BY pr.updated_at DESC LIMIT ?`)
          .bind(String(input.status || ""), String(input.status || ""), Math.min(100, Number(input.limit || 30))).all();
        return { projects: rows.results || [] };
      }),
    );

    this.server.registerTool(
      "nexus_run_full_audit",
      {
        description: "Use para realizar uma auditoria ampla de banco, migrations, colunas, qualidade dos leads e pendências operacionais.",
        inputSchema: {},
        annotations: READ_ANNOTATIONS,
        securitySchemes: READ_SECURITY,
      } as any,
      async () => this.runTool("nexus_run_full_audit", {}, async () => {
        const expected: Record<string, string[]> = {
          leads: ["id", "name", "stage", "archived", "estimated_value", "closed_value", "next_contact_at"],
          proposals: ["id", "proposal_number", "terms", "notes", "updated_at"],
          commercial_tasks: ["id", "due_at", "status", "updated_at"],
          payments: ["id", "amount", "amount_paid", "notes", "updated_at"],
          projects: ["id", "status", "progress", "updated_at"],
          integrations: ["id", "provider", "status", "config_json"],
          campaigns: ["id", "status", "audience_filter"],
          app_migrations: ["migration_key", "applied_at"],
          mcp_audit_log: ["id", "github_login", "tool_name", "status", "created_at"],
        };
        const schema: Record<string, unknown> = {};
        for (const [table, requiredColumns] of Object.entries(expected)) {
          const exists = await tableExists(this.env, table);
          const columns = exists ? await columnsFor(this.env, table) : [];
          schema[table] = { exists, missingColumns: requiredColumns.filter((column) => !columns.includes(column)), columnCount: columns.length };
        }
        const quality = await this.env.DB.prepare(`SELECT
          COUNT(*) total,
          SUM(CASE WHEN COALESCE(phone,'')='' THEN 1 ELSE 0 END) without_phone,
          SUM(CASE WHEN COALESCE(city,'')='' THEN 1 ELSE 0 END) without_city,
          SUM(CASE WHEN COALESCE(niche,'')='' THEN 1 ELSE 0 END) without_niche,
          SUM(CASE WHEN COALESCE(next_contact_at,'')='' AND stage NOT IN ('Fechado','Perdido') THEN 1 ELSE 0 END) without_followup,
          SUM(CASE WHEN datetime(COALESCE(updated_at,created_at))<datetime('now','-14 days') AND stage NOT IN ('Fechado','Perdido') THEN 1 ELSE 0 END) stale
          FROM leads WHERE COALESCE(archived,0)=0`).first<Record<string, unknown>>();
        const duplicates = await this.env.DB.prepare(`SELECT phone,COUNT(*) total FROM leads WHERE COALESCE(archived,0)=0 AND length(trim(COALESCE(phone,'')))>=8 GROUP BY phone HAVING COUNT(*)>1 ORDER BY total DESC LIMIT 30`).all();
        const migrationRows = await this.env.DB.prepare("SELECT migration_key,applied_at FROM app_migrations ORDER BY applied_at").all();
        const schemaOk = Object.values(schema).every((item: any) => item.exists && item.missingColumns.length === 0);
        return {
          ok: schemaOk,
          generatedAt: nowIso(),
          schema,
          migrations: migrationRows.results || [],
          leadQuality: quality || {},
          duplicatePhoneGroups: duplicates.results || [],
          recommendations: [
            !schemaOk ? "Executar as migrations ausentes antes de testar funcionalidades." : null,
            Number(quality?.without_phone || 0) > 0 ? "Completar telefones dos leads prioritários." : null,
            Number(quality?.without_followup || 0) > 0 ? "Agendar próximos contatos para oportunidades abertas." : null,
            Number(quality?.stale || 0) > 0 ? "Revisar leads sem atualização há mais de 14 dias." : null,
            (duplicates.results || []).length > 0 ? "Revisar possíveis duplicidades por telefone." : null,
          ].filter(Boolean),
        };
      }),
    );

    this.server.registerTool(
      "nexus_test_api_endpoints",
      {
        description: "Use para testar os principais endpoints HTTP do Worker principal do Nexus, sem alterar dados.",
        inputSchema: { includeResponsePreview: z.boolean().default(false) },
        annotations: { ...READ_ANNOTATIONS, openWorldHint: false },
        securitySchemes: READ_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_test_api_endpoints", input, async () => {
        const base = String(this.env.NEXUS_APP_URL || "").replace(/\/$/, "");
        if (!base.startsWith("https://")) throw new Error("NEXUS_APP_URL precisa começar com https://");
        const endpoints = [
          "/api/health", "/api/health/details", "/api/v15/command-center", "/api/leads?limit=1",
          "/api/proposals", "/api/tasks", "/api/finance", "/api/v12/projects", "/api/v12/observability",
          "/api/v13/overview", "/api/v14/revenue", "/api/v15/quality-rules",
        ];
        const tests = [];
        for (const endpoint of endpoints) {
          const started = Date.now();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          try {
            const response = await fetch(`${base}${endpoint}`, {
              headers: { "X-App-Token": this.env.NEXUS_APP_TOKEN },
              signal: controller.signal,
            });
            const text = await response.text();
            tests.push({ endpoint, ok: response.ok, status: response.status, durationMs: Date.now() - started, preview: input.includeResponsePreview ? text.slice(0, 500) : undefined });
          } catch (error) {
            tests.push({ endpoint, ok: false, status: 0, durationMs: Date.now() - started, error: error instanceof Error ? error.message : "Falha de rede" });
          } finally {
            clearTimeout(timeout);
          }
        }
        return { baseUrl: base, generatedAt: nowIso(), ok: tests.every((test) => test.ok), tests };
      }),
    );

    this.server.registerTool(
      "nexus_seed_test_scenario",
      {
        description: "Use somente para testar o sistema. Cria um lead de teste e registros vinculados em Agenda, Propostas, Financeiro e Projetos. Exige confirmação explícita.",
        inputSchema: {
          confirm: z.boolean().describe("Precisa ser true para criar os dados de teste."),
          label: z.string().max(80).default("Cenário MCP"),
        },
        annotations: WRITE_ANNOTATIONS,
        securitySchemes: WRITE_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_seed_test_scenario", input, async () => {
        if (input.confirm !== true) throw new Error("Operação cancelada: confirm precisa ser true.");
        const suffix = crypto.randomUUID();
        const leadId = `mcp_test_${suffix}`;
        const taskId = `mcp_test_task_${suffix}`;
        const proposalId = `mcp_test_proposal_${suffix}`;
        const paymentId = `mcp_test_payment_${suffix}`;
        const projectId = `mcp_test_project_${suffix}`;
        const runId = `mcp_run_${suffix}`;
        const due = new Date(Date.now() + 3 * 86400000).toISOString();
        const valid = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const label = limitedText(input.label, 80) || "Cenário MCP";
        await this.env.DB.batch([
          this.env.DB.prepare(`INSERT INTO leads(id,name,niche,city,phone,website,presence,reviews,rating,score,priority,stage,source,notes,next_contact_at,favorite,contact_name,email,estimated_value,archived,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
            .bind(leadId, `${label} — Teste`, "Teste de software", "Goiânia", "62999990000", "", "Sem site", 0, 0, 90, "Alta", "Novo", "MCP Test", "Registro criado automaticamente para validação. Pode ser removido pela ferramenta de limpeza MCP.", due, 0, "Contato de teste", "mcp-test@example.invalid", 697, 0),
          this.env.DB.prepare("INSERT INTO lead_insights(lead_id,reasons_json,calculated_at) VALUES(?,?,CURRENT_TIMESTAMP)").bind(leadId, JSON.stringify(["Cenário de teste MCP"])),
          this.env.DB.prepare("INSERT INTO lead_activities(lead_id,activity_type,description) VALUES(?,'mcp_test','Cenário completo de teste criado pelo MCP.')").bind(leadId),
          this.env.DB.prepare(`INSERT INTO commercial_tasks(id,lead_id,title,task_type,due_at,status,priority,notes,updated_at)
            VALUES(?,?,?,'Follow-up',?,'Pendente','Alta','Tarefa criada pelo cenário MCP.',CURRENT_TIMESTAMP)`).bind(taskId, leadId, `${label} — Follow-up`, due),
          this.env.DB.prepare(`INSERT INTO proposals(id,lead_id,title,status,amount,scope,valid_until,terms,notes,proposal_number,updated_at)
            VALUES(?,?,?,'Rascunho',697,'Landing page de demonstração',?,'Pagamento na entrega','Proposta de teste MCP',?,CURRENT_TIMESTAMP)`).bind(proposalId, leadId, `${label} — Proposta`, valid, `MCP-${suffix.slice(0, 8).toUpperCase()}`),
          this.env.DB.prepare(`INSERT INTO payments(id,lead_id,proposal_id,description,amount,status,due_date,payment_method,amount_paid,notes,updated_at)
            VALUES(?,?,?,? ,697,'Pendente',?,'PIX',0,'Cobrança de teste MCP',CURRENT_TIMESTAMP)`).bind(paymentId, leadId, proposalId, `${label} — Cobrança`, valid),
          this.env.DB.prepare(`INSERT INTO projects(id,lead_id,proposal_id,title,status,progress,due_date,owner,notes,updated_at)
            VALUES(?,?,?,?,'Planejamento',10,?,'MCP','Projeto de teste MCP',CURRENT_TIMESTAMP)`).bind(projectId, leadId, proposalId, `${label} — Projeto`, valid),
          this.env.DB.prepare(`INSERT INTO mcp_test_runs(id,github_login,lead_id,status,created_at) VALUES(?,?,?,'created',CURRENT_TIMESTAMP)`).bind(runId, this.props.login, leadId),
        ]);
        return { ok: true, runId, leadId, taskId, proposalId, paymentId, projectId, message: "Cenário de teste criado e identificado com prefixo mcp_test_." };
      }),
    );

    this.server.registerTool(
      "nexus_cleanup_test_data",
      {
        description: "Exclui somente dados criados pelas ferramentas MCP com prefixo mcp_test_. Não remove dados reais. Exige a frase de confirmação exata.",
        inputSchema: {
          confirmation: z.string().describe("Use exatamente: DELETE_MCP_TEST_DATA"),
        },
        annotations: DELETE_ANNOTATIONS,
        securitySchemes: WRITE_SECURITY,
      } as any,
      async (input: any) => this.runTool("nexus_cleanup_test_data", input, async () => {
        if (input.confirmation !== "DELETE_MCP_TEST_DATA") throw new Error("Frase de confirmação incorreta.");
        const count = await this.env.DB.prepare("SELECT COUNT(*) total FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test'").first<Record<string, unknown>>();
        await this.env.DB.batch([
          this.env.DB.prepare("DELETE FROM campaign_members WHERE lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM client_portals WHERE project_id IN (SELECT id FROM projects WHERE id LIKE 'mcp_test_%')"),
          this.env.DB.prepare("DELETE FROM project_tasks WHERE project_id LIKE 'mcp_test_%'"),
          this.env.DB.prepare("DELETE FROM payments WHERE id LIKE 'mcp_test_%' OR lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM commercial_tasks WHERE id LIKE 'mcp_test_%' OR lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM projects WHERE id LIKE 'mcp_test_%' OR lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM proposals WHERE id LIKE 'mcp_test_%' OR lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM website_analyses WHERE lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM lead_insights WHERE lead_id IN (SELECT id FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test')"),
          this.env.DB.prepare("DELETE FROM leads WHERE id LIKE 'mcp_test_%' OR source='MCP Test'"),
          this.env.DB.prepare("UPDATE mcp_test_runs SET status='cleaned',cleaned_at=CURRENT_TIMESTAMP WHERE status='created'"),
        ]);
        return { ok: true, removedLeadCount: Number(count?.total || 0), message: "Somente dados identificados como testes MCP foram removidos." };
      }),
    );
  }
}
