# Testes unitários

Este projeto tem duas suítes de testes para atingir alta cobertura.

## 1. Registry (frontend) – Vitest + jsdom

Testa o módulo `registry.js` (formulário de registro e modal).

```bash
npm install
npm run test           # rodar testes
npm run test:coverage  # cobertura (statements/lines/funcs 100%)
```

- **Arquivos:** `registry.test.js`, `registry.js`
- **Cobertura:** 100% em statements, funções e linhas; ~87% em branches.

## 2. Supabase Edge Functions (_shared) – Deno

Testa helpers compartilhados das Edge Functions (http, supabase, parse_tenant, decode_base64).

Requisito: [Deno](https://deno.land/) instalado.

```bash
cd supabase/functions
deno task test              # rodar testes
deno task test:coverage     # cobertura (gera cov/ e cov.lcov)
```

- **Arquivos de teste:** `_shared/*.test.ts`
- **Import map:** `import_map.test.json` (usa mock do Supabase em vez do cliente real).

### O que é testado

| Módulo | Descrição |
|--------|-----------|
| `http.ts` | `corsHeaders`, `jsonResponse`, `handleCors` (OPTIONS vs GET/POST) |
| `supabase.ts` | `createAdminClient` (env vazio), `getAuthenticatedUserId` (Bearer ausente/inválido/válido), `getUserTenantId` (sucesso e sem tenant) |
| `parse_tenant.ts` | `parseTenantIdFromInstance` (vazio, &lt; 32 chars, com/sem prefixo `tenant_`) |
| `decode_base64.ts` | `decodeBase64ToBytes` (string simples, data URL, vazio) |

## Resumo

- **registry.js:** `npm run test` / `npm run test:coverage` na raiz.
- **Edge Functions (_shared):** `deno task test` (e opcionalmente `deno task test:coverage`) em `supabase/functions`.
