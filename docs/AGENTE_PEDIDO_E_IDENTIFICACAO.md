# Agente: identificação, formatação e fluxo de pedido

Resumo das regras e implementações para o agente de atendimento (WhatsApp / n8n).

---

## 1. Identificação obrigatória

- O agente deve **sempre** se identificar com **nome do assistente** e **nome da empresa** na primeira resposta substantiva (saudação ou primeira pergunta).
- Exemplo: *"Boa noite! Aqui é o [nome do assistente] do [nome da empresa]. Em que posso ajudar?"*
- O nome da empresa vem de `tenants.name`, enviado no payload para o n8n como **`tenantName`**. O webhook já envia esse campo.

---

## 2. Formatação das respostas

- **Todas** as mensagens que tenham lista, preços ou mais de um item: usar **quebras de linha**; totais e valores importantes em **negrito**.
- Nunca enviar vários itens/preços em um único parágrafo sem formatação.
- Ordem: resposta direta → detalhes em lista → pergunta ou oferta de ajuda só quando fizer sentido.

---

## 3. Campos do pedido (obrigatórios antes de confirmar)

O agente deve reunir e confirmar estes três pontos em todo pedido com entrega:

| Campo | Descrição |
|-------|------------|
| **Itens e quantidades** | Ex.: 5 caixas Heineken, 3 Amstel, 2 Original. |
| **Forma de pagamento** | Ex.: dinheiro, Pix, cartão débito, cartão crédito. |
| **Endereço de entrega** | Completo: rua, número, complemento, bairro (e referência se relevante). |

- Após fechar itens e total → perguntar **forma de pagamento**.
- Quando for pedido com entrega → perguntar **endereço de entrega**.

No banco, a tabela **`conversations`** tem as colunas para uso futuro ou integração:
- **`payment_method`** (text)
- **`delivery_address`** (text)
- **`order_summary`** (jsonb: itens, total, forma de pagamento, endereço)

Hoje o agente não preenche essas colunas automaticamente; o fluxo é guiado pelo prompt. Uma integração ou um passo no n8n pode preencher esses campos depois.

---

## 4. Confirmação de pedido e hand-off ao vendedor

- **Antes de qualquer confirmação final**, o agente deve mostrar um **resumo completo** em uma única mensagem:
  - Lista de itens com valor unitário e subtotal
  - **Total** em negrito
  - **Forma de pagamento**
  - **Endereço de entrega** (se for entrega)

- Em seguida, **obrigatório:** informar que **não tem acesso ao estoque** e que **vai chamar um vendedor** para confirmar disponibilidade e finalizar.  
  Ex.: *"Anotei tudo. Como não tenho acesso ao estoque, vou repassar para um vendedor confirmar disponibilidade e prazo de entrega. Em breve alguém te retorna para fechar."*

- O agente **nunca** deve confirmar sozinho que o pedido está "confirmado" ou "agendado" para entrega. A confirmação final e o agendamento são feitos pelo vendedor após checagem de estoque.

---

## 5. Áudio (mensagens de voz)

- As mensagens de voz são **transcritas** (OpenAI Whisper) no webhook e o **texto transcrito** é:
  - enviado para o n8n no campo **`message`**,
  - e salvo no histórico da conversa como mensagem do usuário (role `user`, campo `message`).
- Ou seja: o que o cliente disse em áudio **fica salvo como texto** no array **`conversations.messages`**. Se em algum momento o áudio falhar ou não for transcrito, o usuário recebe uma mensagem de fallback e nada é inventado.

---

## 6. Onde está implementado

| O quê | Onde |
|-------|------|
| Regras de identificação, formatação, pedido e hand-off | System prompt em `docs/SYSTEM_PROMPT_AGENTE_TENANT.md` e no workflow n8n `StratosBot/n8n-workflow-saas-stratosbot.json` (nó AI Agent, system message). |
| Nome da empresa no prompt | Payload do webhook: `tenantName` (de `tenants.name`). Variável `[COMPANY_NAME]` no prompt. |
| Colunas do pedido no banco | Tabela `conversations`: `payment_method`, `delivery_address`, `order_summary` (migration `add_conversation_order_fields`). |
| Envio de `tenantName` ao n8n | Edge Function `whatsapp-webhook`: busca `tenants.name` e inclui no body para o n8n. |

Para passar a usar os campos `payment_method`, `delivery_address` e `order_summary` na prática (ex.: tela de resumo, integração com ERP), é preciso algum passo que os preencha (por exemplo um nó no n8n que envie esses dados para uma API ou para o Supabase).
