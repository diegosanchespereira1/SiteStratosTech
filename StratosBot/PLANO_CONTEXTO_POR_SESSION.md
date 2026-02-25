# Plano: Uma linha por sessionId com contexto completo da conversa

## Objetivo

- Uma **única linha** por `session_id` na tabela `stratosbot_site`.
- A conversa inteira do usuário é **atualizada** nessa linha (acumulada em um array).
- O bot usa esse contexto por sessão e não mistura conversas nem "esquece" o que já foi dito.

## Situação atual

- **Tabela:** uma linha por mensagem (várias linhas por `session_id`).
- **Workflow:** Formatar Resposta → Inserir Supabase (Insert) → Responder Site.
- **Memória do bot:** Redis Chat Memory com `sessionKey = sessionId` (já separado por sessão).

O que falta é o **Supabase** refletir o mesmo modelo: uma linha por sessão, com a conversa completa.

---

## Arquitetura proposta

```
Formatar Resposta
       ↓
Buscar sessão no Supabase (Get por session_id)
       ↓
Code: montar conversation (append ou criar array)
       ↓
Upsert por session_id (Insert ou Update)
       ↓
Responder Site
```

---

## 1. Alteração no banco (Supabase)

**Arquivo:** `StratosBot/stratosbot_site_table.sql` (e script de migração)

### 1.1 Novas colunas e constraint

- **`conversation` (JSONB)** – array de turnos, ex.:  
  `[{ "role": "user", "message": "...", "reply": "...", "at": "ISO8601" }, ...]`
- **`updated_at` (timestamptz)** – última atualização da sessão.
- **UNIQUE(session_id)** – garante uma linha por sessão.

### 1.2 Migração dos dados existentes

- Agrupar linhas atuais por `session_id`.
- Para cada `session_id`: montar um único registro com `conversation` = array ordenado por `created_at`.
- Inserir na nova estrutura e aplicar UNIQUE em `session_id` (tratando duplicatas antes).

### 1.3 Scripts SQL sugeridos

1. Adicionar colunas sem quebrar o que existe:
   - `ALTER TABLE ... ADD COLUMN conversation JSONB DEFAULT '[]'::jsonb;`
   - `ALTER TABLE ... ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();`
2. Migrar: um script que agrupa por `session_id`, monta `conversation` e insere/atualiza (ou cria tabela nova e renomeia).
3. Remover duplicatas por `session_id` (manter uma linha por sessão com `conversation` preenchido).
4. Adicionar constraint: `ALTER TABLE ... ADD CONSTRAINT stratosbot_site_session_id_key UNIQUE (session_id);`

---

## 2. Fluxo no n8n (workflow)

**Arquivo:** `StratosBot/n8n-workflow-site-stratosbot.json`

### 2.1 Novo nó: Buscar sessão (Supabase Get)

- **Operação:** Get (ou Get many com filtro e limit 1).
- **Filtro:** `session_id` = `{{ $json.sessionId }}` (dados vêm do Formatar Resposta).
- **Saída:** 0 ou 1 linha (conversa atual da sessão).

### 2.2 Novo nó: Code – montar conversation

- **Entrada:** saída do Formatar Resposta + saída do Get (se houver).
- **Lógica:**
  - Se não existe linha: `conversation = [{ role: 'user', message, reply, at: now }]`.
  - Se existe: ler `conversation` da linha, fazer **append** do novo turno `{ role, message, reply, at }`.
  - Opcional: limitar tamanho do array (ex.: últimos 50 turnos) para não crescer indefinidamente.
- **Saída:** objeto com `session_id`, `conversation`, `message`, `reply`, `source`, `channel`, `updated_at`, etc., para o próximo nó.

### 2.3 Alterar nó: Inserir Supabase Site → Upsert por session_id

- **Operação:** Upsert (ou equivalente com conflito em `session_id`).
- **Campos:** `session_id`, `conversation`, `message`, `reply`, `source`, `channel`, `updated_at`, e demais campos obrigatórios da tabela.
- Comportamento: se não existir linha com esse `session_id` → INSERT; se existir → UPDATE (substituir `conversation`, `message`, `reply`, `updated_at`).

### 2.4 Ordem final do fluxo

- Formatar Resposta → **Buscar sessão** → **Code (conversation)** → **Upsert Supabase** → Responder Site.

### 2.5 Ramo mensagem vazia

- Resposta Vazia → Responder Site: pode permanecer sem gravar no Supabase (ou gravar turno vazio, conforme regra de negócio).

---

## 3. Uso do contexto pelo bot

- **Redis Chat Memory** já usa `sessionId`; o agente já tem contexto por sessão em memória.
- O **Supabase** passa a ser a fonte persistida: uma linha por `session_id` com `conversation` completo.
- **Opcional (fase futura):** antes do Agente, um nó pode ler a linha da sessão no Supabase e injetar o `conversation` no prompt, garantindo contexto mesmo após reinício do Redis.

---

## 4. Alternativa: RPC no Supabase (opcional)

Para evitar Get + Code + Upsert no n8n:

- Criar função PostgreSQL, ex.:  
  `append_conversation_turn(p_session_id text, p_message text, p_reply text)`  
  que faz INSERT ou UPDATE com  
  `conversation = conversation || jsonb_build_array(...)` e `updated_at = now()`.
- No n8n: um único nó que chama essa RPC após Formatar Resposta, depois Responder Site.

Reduz nós e centraliza a lógica no banco.

---

## 5. Ordem de implementação

1. **SQL:** adicionar `conversation` e `updated_at`; migrar dados por `session_id`; aplicar UNIQUE em `session_id`.
2. **n8n:** adicionar nó Get (buscar sessão); nó Code (montar conversation); alterar Inserir Supabase para Upsert por `session_id`.
3. **Testes:** nova sessão cria uma linha; mensagens seguintes na mesma sessão atualizam a mesma linha e aumentam o array `conversation`.
4. **(Opcional)** Implementar RPC e simplificar o workflow.

---

## 6. Resumo dos arquivos

| Arquivo | Alteração |
|---------|-----------|
| `StratosBot/stratosbot_site_table.sql` | Novo schema: `conversation`, `updated_at`, migração, UNIQUE(session_id). |
| `StratosBot/n8n-workflow-site-stratosbot.json` | Novo fluxo: Formatar Resposta → Get → Code → Upsert → Responder Site. |

Com isso, toda conversa do mesmo usuário (mesmo `sessionId`) fica em **uma única linha**, atualizada com o contexto completo.
