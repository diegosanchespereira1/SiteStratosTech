#!/usr/bin/env python3
"""
Gera o workflow n8n v11: adiciona HTTP Request Tool (RPC Supabase) ao Agente Principal
e atualiza o system prompt.

Uso:
  python3 apply_wladvan_supabase_tool.py caminho/para/export.json > n8n-workflow-wladvan-v11-supabase.json

O export pode ser o JSON completo do n8n (com name, nodes, connections, settings)
ou um objeto {"workflow": {...}}.
"""
from __future__ import annotations

import json
import sys
from typing import Any

AGENTE_PRINCIPAL_ID = "cc4b628f-96ed-487e-9c78-73e3863079fc"
AGENTE_PRINCIPAL_NAME = "Agente Principal"

TOOL_NODE: dict[str, Any] = {
    "parameters": {
        "toolDescription": (
            "Consulta o catálogo interno Wladvan no Supabase (função search_wladvan_products). "
            "Use SEMPRE que o cliente perguntar se temos uma peça, código, preço, estoque ou nome de produto. "
            "Passe em search_query termos curtos: nome da peça, código interno, código fabricante ou palavras-chave. "
            "Não invente dados: use apenas o retorno da ferramenta."
        ),
        "method": "POST",
        "url": "https://eefnsjulakraiwcehrkt.supabase.co/rest/v1/rpc/search_wladvan_products",
        "authentication": "none",
        "sendQuery": False,
        "sendHeaders": True,
        "specifyHeaders": "keypair",
        "parametersHeaders": {
            "values": [
                {
                    "name": "apikey",
                    "value": "COLE_AQUI_A_SERVICE_ROLE_KEY_DO_SUPABASE",
                },
                {
                    "name": "Authorization",
                    "value": "Bearer COLE_AQUI_A_SERVICE_ROLE_KEY_DO_SUPABASE",
                },
                {"name": "Content-Type", "value": "application/json"},
                {"name": "Prefer", "value": "return=representation"},
            ]
        },
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": '{"search_query":"{search_query}","max_rows":15}',
        "placeholderDefinitions": {
            "values": [
                {
                    "name": "search_query",
                    "description": (
                        "Texto de busca: nome da peça, código interno Wladvan, código fabricante ou veículo."
                    ),
                    "type": "string",
                }
            ]
        },
        "optimizeResponse": False,
    },
    "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
    "typeVersion": 1.1,
    "position": [-400, 2180],
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "buscar_catalogo_wladvan",
}

MARK_START = "---\n\n# REGRAS DE ATENDIMENTO\n"
MARK_END = "\n\n---\n\n# TRANSFERÊNCIA PARA ATENDENTE\n"

NEW_RULES_BLOCK = """---

# CATÁLOGO SUPABASE (OBRIGATÓRIO)
- Antes de responder sobre **existência de peça**, **estoque**, **preço** ou **código**, chame a ferramenta **buscar_catalogo_wladvan** com `search_query` (use o que o cliente disse + marca/modelo se já souber).
- O retorno da RPC lista produtos com campos como sku (código interno), name, price_brl, product_status, stock_total. **Só cite preço ou disponibilidade** se vierem na resposta da ferramenta.
- Se a lista vier **vazia**, diga que não encontrou no catálogo e ofereça um vendedor — **não invente** preço nem estoque.
- Se **price_brl** for nulo no catálogo, não invente valor; diga que o preço precisa ser confirmado com um vendedor.

---

# REGRAS DE ATENDIMENTO
1. **Peças:** Pergunte apenas as informações que ainda não foram fornecidas (marca, modelo, ano). Use o conhecimento de veículos para não repetir perguntas desnecessárias.
2. **Catálogo / estoque / preço:** use **sempre** a ferramenta buscar_catalogo_wladvan quando o tema for produto, disponibilidade ou valor. Sem resultado da ferramenta, não confirme disponibilidade nem preço.
3. **Endereço:** Informe as duas unidades e pergunte se precisa de mais ajuda.
4. **Horário:** Responda sim/não e informe o horário correto.
5. **Pagamento:** Informe as formas disponíveis.
6. **Entrega:** Informe os prazos conforme o canal de compra."""


def patch_system_message(text: str) -> str:
    if MARK_START not in text or MARK_END not in text:
        raise ValueError(
            "Prompt do Agente Principal não contém o bloco esperado (# REGRAS … # TRANSFERÊNCIA). "
            "Atualize manualmente ou use um export do workflow v10 original."
        )
    before = text.split(MARK_START)[0]
    after = text.split(MARK_END)[-1]
    return before + NEW_RULES_BLOCK + MARK_END + after


def patch_workflow(wf: dict[str, Any]) -> dict[str, Any]:
    out = dict(wf)
    out["name"] = "Chatwoot AI Agent - Wladvan v11 Supabase"

    nodes = list(out.get("nodes") or [])
    found = False
    for i, node in enumerate(nodes):
        if node.get("id") == AGENTE_PRINCIPAL_ID and node.get("name") == AGENTE_PRINCIPAL_NAME:
            opts = (node.get("parameters") or {}).get("options") or {}
            sm = opts.get("systemMessage")
            if not isinstance(sm, str):
                raise ValueError("Agente Principal sem systemMessage em texto.")
            opts = dict(opts)
            opts["systemMessage"] = patch_system_message(sm)
            params = dict(node.get("parameters") or {})
            params["options"] = opts
            node = dict(node)
            node["parameters"] = params
            nodes[i] = node
            found = True
            break
    if not found:
        raise ValueError(f"Nó {AGENTE_PRINCIPAL_NAME} ({AGENTE_PRINCIPAL_ID}) não encontrado.")

    names = {n.get("name") for n in nodes}
    if TOOL_NODE["name"] in names:
        for i, n in enumerate(nodes):
            if n.get("name") == TOOL_NODE["name"]:
                nodes[i] = TOOL_NODE
                break
    else:
        nodes.append(TOOL_NODE)

    out["nodes"] = nodes

    conn = dict(out.get("connections") or {})
    conn["buscar_catalogo_wladvan"] = {
        "ai_tool": [[{"node": AGENTE_PRINCIPAL_NAME, "type": "ai_tool", "index": 0}]]
    }
    out["connections"] = conn

    if "meta" not in out or out["meta"] is None:
        out["meta"] = {}
    if isinstance(out["meta"], dict):
        out["meta"]["templateCredsSetupCompleted"] = out["meta"].get("templateCredsSetupCompleted", True)

    return out


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python3 apply_wladvan_supabase_tool.py <export.json>|-", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    if path == "-":
        data = json.load(sys.stdin)
    else:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    wf = data.get("workflow", data)
    patched = patch_workflow(wf)
    json.dump(patched, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
