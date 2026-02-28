# Como coletar logs do processamento do arquivo guia

Quando um cliente tem problema no **processamento do arquivo guia** (upload ou “Processar documento”), use as fontes abaixo para diagnosticar. Você precisa do **tenant_id** do cliente (ex.: tabela `tenants` pelo nome ou pelo e-mail do usuário em `tenant_members`).

---

## 1. Logs das Edge Functions (Supabase Dashboard)

1. Acesse o [Supabase Dashboard](https://supabase.com/dashboard) do projeto SaaS.
2. Menu lateral → **Edge Functions**.
3. Abra os logs de:
   - **knowledge-upload** – falha no upload ou ao gravar em `knowledge_files`.
   - **knowledge-process** – falha ao baixar do storage, ao gerar chunks ou ao atualizar status.

Cada invocação mostra request/response e erros. Filtre pelo horário em que o cliente tentou processar.

---

## 2. Tabela de operações por tenant (`tenant_operation_logs`)

A partir do deploy que inclui logs em `knowledge-upload` e `knowledge-process`, as ações passam a ser registradas em `tenant_operation_logs`. Para consultar com **service role** (suporte/admin):

1. No Supabase: **SQL Editor**.
2. Use a query abaixo trocando `'SEU_TENANT_ID_AQUI'` pelo UUID do tenant do cliente:

```sql
-- Logs do tenant (upload e processamento do arquivo guia)
SELECT id, source, level, event, message, details, created_at
FROM public.tenant_operation_logs
WHERE tenant_id = 'SEU_TENANT_ID_AQUI'
  AND source IN ('knowledge-upload', 'knowledge-process')
ORDER BY created_at DESC
LIMIT 50;
```

Eventos úteis:

| source             | event                  | Significado |
|--------------------|------------------------|-------------|
| knowledge-upload   | file_uploaded          | Upload concluído; próximo passo é chamar knowledge-process. |
| knowledge-upload   | storage_upload_failed  | Falha ao enviar arquivo para o bucket `knowledge-files`. |
| knowledge-upload   | upload_failed          | Falha ao inserir em `knowledge_files`. |
| knowledge-process  | processing_started     | Início do processamento do arquivo. |
| knowledge-process  | processing_completed   | Processamento concluído (chunks gravados). |
| knowledge-process  | file_not_found         | knowledgeFileId não existe ou não pertence ao tenant. |
| knowledge-process  | storage_download_failed | Falha ao baixar o arquivo do storage (path/permissão/bucket). |
| knowledge-process  | chunks_insert_failed   | Falha ao inserir em `knowledge_chunks` (ex.: limite, constraint). |

---

## 3. Estado dos arquivos guia (`knowledge_files`)

Para ver status e mensagem de erro dos arquivos daquele tenant:

```sql
SELECT id, file_name, storage_path, mime_type, size_bytes, status, error_message, created_at, updated_at
FROM public.knowledge_files
WHERE tenant_id = 'SEU_TENANT_ID_AQUI'
ORDER BY created_at DESC
LIMIT 20;
```

- **status**: `uploaded` → aguardando processar; `processing` → em processamento; `ready` → ok; `failed` → erro (veja `error_message`).
- **error_message**: preenchido quando `status = 'failed'` (ex.: mensagem do Postgres ao inserir chunks).

---

## 4. Descobrir o tenant_id do cliente

Se você só tem o e-mail do usuário:

```sql
SELECT t.id AS tenant_id, t.name AS tenant_name, tm.user_id, tm.role
FROM public.tenants t
JOIN public.tenant_members tm ON tm.tenant_id = t.id
JOIN auth.users u ON u.id = tm.user_id
WHERE u.email = 'email@do-cliente.com';
```

Use o `tenant_id` retornado nas queries das seções 2 e 3.

---

## 5. Health do tenant (via API / onboarding)

O cliente pode abrir o onboarding → **Health Operacional** e clicar em **Atualizar health**. A API `tenant-health` lê os últimos logs de `tenant_operation_logs` e mostra erros recentes. Se houver registro de `knowledge-process` ou `knowledge-upload` com nível `error`, isso aparece nos **Erros recentes** do health. Isso ajuda a confirmar se o problema foi registrado nos logs.

---

## Resumo rápido

| Onde                         | O que ver |
|-----------------------------|-----------|
| Edge Functions → knowledge-upload / knowledge-process | Logs de cada chamada (stack trace, 500, etc.). |
| SQL: `tenant_operation_logs` | Histórico de eventos de upload e processamento do arquivo guia. |
| SQL: `knowledge_files`       | Status e `error_message` dos arquivos do tenant. |
| Onboarding → Health         | Últimos erros do tenant, incluindo knowledge, se já houver logs. |

Depois de fazer o **deploy** das Edge Functions com as alterações de log (`writeOperationLog` em knowledge-upload e knowledge-process), as novas execuções passam a preencher `tenant_operation_logs`; para falhas antigas, use apenas os logs das Edge Functions e a tabela `knowledge_files`.
