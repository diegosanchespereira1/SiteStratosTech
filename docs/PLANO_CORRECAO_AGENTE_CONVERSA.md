# Plano de correção – agente (conversa analisada)

Com base na conversa enviada e no prompt atual, segue o plano antes de implementar.

---

## 1. Variáveis [nome] / [Assistente] aparecendo na resposta

**O que aconteceu**
- O bot respondeu: *"Aqui é o [nome] do Galpão Continental"* e depois *"Aqui é o [Assistente] do Galpão Continental"*.
- No prompt, os exemplos de apresentação usam literalmente **"[nome]"** e **"[empresa]"** (ex.: *"Aqui é o [nome] do [empresa]. Em que posso ajudar?"*). A LLM está copiando esse texto em vez de usar o nome real do assistente e da empresa.

**Origem**
- A identidade já é injetada no início do system message (ex.: *"Você é o assistente virtual 'X' da empresa 'Y'"*), mas mais abaixo há exemplos com placeholders. O modelo não está tratando [nome]/[empresa] como “substitua aqui”; ele repete o placeholder ou usa [Assistente].

**Correção**
- Remover dos exemplos qualquer **[nome]**, **[empresa]** ou **[Assistente]**.
- Usar exemplos com texto fixo, ex.: *"Boa noite! Aqui é o assistente do Galpão Continental. Em que posso ajudar?"*.
- Incluir regra explícita: **"Use sempre o nome real do assistente e o nome real da empresa (os mesmos da seção IDENTIDADE acima). NUNCA escreva [nome], [empresa], [Assistente] ou outros placeholders na resposta ao cliente."**

---

## 2. Perguntar o nome do cliente no início

**O que aconteceu**
- O cliente disse que queria fazer pedido; o bot se apresentou e pediu produtos/quantidades, mas não perguntou o nome. Só perguntou o nome quando o cliente reclamou (*"e vc nao vai perguntar o meu nome?"*).

**Correção**
- Incluir no fluxo de início de atendimento: **"Pergunte o nome do cliente no início** (na primeira troca após saudação/identificação, ou assim que o cliente disser que quer fazer pedido). Ex.: 'Qual seu nome, por favor?' ou 'Para eu anotar o pedido, qual seu nome?'"
- Ordem sugerida: saudação + identificação → **perguntar nome** → em seguida itens/quantidades, forma de pagamento, endereço (se entrega).

---

## 3. Endereço de entrega antes de finalizar

**O que aconteceu**
- O bot fez o hand-off (*"vou repassar para um vendedor"*) logo após itens + forma de pagamento, **sem** ter pedido o endereço. Só perguntou o endereço quando o cliente questionou (*"vc nao vai perguntar o endereço?"*).

**Correção**
- Deixar explícito na regra de **pedido e hand-off**:
  - Se for **pedido com entrega**, a ordem é: (1) nome do cliente, (2) itens e quantidades, (3) forma de pagamento, (4) **endereço de entrega**.
  - **Só depois** de ter os quatro (nome, itens, pagamento, endereço) o agente monta o resumo completo e faz o hand-off.
- Incluir: **"Nunca diga que vai repassar para o vendedor antes de ter o endereço de entrega quando o pedido for para entrega."**

---

## 4. Textos longos em uma única frase

**O que aconteceu**
- Várias respostas ainda vêm em blocos longos (ex.: lista de preços enorme em um único parágrafo, ou frases muito longas).

**Correção**
- Reforçar na **formatação**:
  - Frases curtas; evitar orações muito longas.
  - **Listas (produtos, preços):** uma linha por item; **cada linha com no máximo ~80 caracteres**; quebrar se passar disso.
- Incluir: **"Nunca envie lista grande (muitos produtos ou preços) em uma única frase ou parágrafo. Quebre em linhas de até ~80 caracteres."**

---

## 5. Lista de produtos em uma única frase / ~80 caracteres por mensagem

**O que aconteceu**
- Na resposta "quais produtos vc tem?", o bot mandou a lista em várias linhas (até ok), mas a mensagem de preços foi um bloco enorme; o cliente pediu para quebrar em mensagens de ~80 caracteres.

**Correção**
- Interpretação adotada: **dentro da mesma mensagem**, quebrar o texto em **linhas de aproximadamente 80 caracteres** (não necessariamente várias mensagens separadas no WhatsApp).
- Regra no prompt: **"Listas longas (catálogo de produtos, tabela de preços): use uma linha por item e, se uma linha passar de ~80 caracteres, quebre em duas. Objetivo: leitura fácil no celular."**
- Opcional (se no futuro quiserem 2+ mensagens): o webhook/n8n poderia splitar a resposta do agente por "\n\n" e enviar cada bloco como mensagem separada; isso fica fora do escopo deste plano e pode ser fase 2.

---

## 6. Repetir várias vezes "não tenho acesso ao estoque"

**O que aconteceu**
- O bot disse que não tinha acesso ao estoque e que ia repassar para o vendedor **em 3 momentos**: após itens+pagamento, após o endereço, e após o nome. Ficou repetitivo.

**Correção**
- Regra explícita: **"A frase sobre não ter acesso ao estoque e repassar para o vendedor deve ser dita apenas UMA vez, no momento do hand-off final** (quando você já tiver: nome do cliente, itens, forma de pagamento, endereço de entrega se for o caso, e for enviar o resumo). Não repita em mensagens seguintes."

---

## Resumo das alterações no prompt

| # | Tema | Ajuste no system prompt |
|---|------|--------------------------|
| 1 | Placeholders na resposta | Remover [nome]/[empresa] dos exemplos; acrescentar regra: nunca escrever placeholders; usar sempre o nome real do assistente e da empresa. |
| 2 | Nome do cliente | Pedir nome no início (primeira troca ou ao primeiro pedido); ordem: identificação → nome → itens → pagamento → endereço (se entrega). |
| 3 | Endereço antes de hand-off | Ordem obrigatória para entrega: nome, itens, pagamento, **endereço**; só depois resumo + hand-off. Nunca repassar ao vendedor sem endereço quando for entrega. |
| 4 | Texto longo | Frases curtas; listas com uma linha por item; linhas com no máximo ~80 caracteres. |
| 5 | Lista de produtos/preços | Listas longas: uma linha por item; quebrar linhas com mais de ~80 caracteres. |
| 6 | Frase do estoque | Dizer "não tenho acesso ao estoque / vou repassar ao vendedor" **apenas uma vez**, no hand-off final. |

---

## Onde implementar

- **docs/SYSTEM_PROMPT_AGENTE_TENANT.md:** atualizar o bloco do prompt (identidade, exemplos, formatação, pedido, hand-off).
- **StratosBot/n8n-workflow-saas-stratosbot.json:** atualizar o `systemMessage` do nó AI Agent com as mesmas regras (sem placeholders nos exemplos; variáveis continuam sendo `name` e `companyName` injetadas no início).

---

## Não alterar (confirmação)

- A identidade já é montada com `name` e `companyName` reais no início do system message (n8n usa `body.assistantName` e `body.tenantName`). O problema é só os **exemplos** com [nome]/[empresa] e a falta de regra “nunca escreva placeholders”.
- Fluxo de hand-off continua: resumo completo (itens, total, pagamento, endereço) + **uma única** mensagem de “não tenho acesso ao estoque, vou repassar ao vendedor”.

Se estiver de acordo com este plano, o próximo passo é aplicar essas alterações no `SYSTEM_PROMPT_AGENTE_TENANT.md` e no `n8n-workflow-saas-stratosbot.json`.
