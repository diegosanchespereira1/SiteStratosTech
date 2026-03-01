# Análise: melhoria do comportamento do agente de atendimento

Conversa analisada: Galpão Continental (distribuidor de bebidas). O agente deve auxiliar clientes com dúvidas, qualificar lead, ajudar a vender e até marcar reunião, conforme a configuração do tenant. Como o tenant tem pouco conhecimento de prompt/IA, a aplicação precisa garantir um padrão de qualidade mesmo com configuração mínima.

---

## 1. Problemas identificados

### 1.1 Repetição de frases de fechamento

- **O que acontece:** Quase toda resposta termina com uma das variantes:
  - "Posso ajudar com mais alguma coisa?"
  - "Posso ajudar com mais alguma dúvida?"
  - "Posso ajudar com mais alguma informação?"
- **Impacto:** Fica robótico e cansativo. O cliente percebe o padrão.
- **Exemplos na conversa:** Após preço da Original, entrega, custo de entrega, prazo, nota fiscal, localização, bebidas, boleto, cadastro, faturado, desconto, vodka, falar com vendedor — sempre o mesmo tipo de fechamento.

### 1.2 Repetição de “consulte conosco”

- **O que acontece:** Quando não tem a informação exata, o agente repete sempre algo como:
  - "Recomendo entrar em contato conosco"
  - "consultar diretamente conosco"
  - "Para uma informação precisa, recomendo consultar diretamente conosco"
- **Impacto:** Parece que o bot “não sabe de nada” e empurra tudo para “fale conosco”.
- **Onde aparece:** Custo de entrega, prazo de 10 caixas, boleto, pedido faturado, desconto para pedidos grandes.

### 1.3 Resposta em bloco único (falta de estrutura)

- **O que acontece:** Várias respostas são um único parágrafo longo, com preços, condições e pergunta no mesmo bloco.
- **Impacto:** No WhatsApp fica difícil escanear; o cliente precisa reler para achar o que importa.
- **Exemplo:** Resposta sobre preço da Original 600ml — valores (Pix, débito, crédito) e “Posso ajudar com mais alguma coisa?” no mesmo parágrafo. O ideal é separar: resposta direta, depois (se fizer sentido) oferta de ajuda.

### 1.4 Listas e números pouco destacados

- **O que acontece:** Quando há lista (produtos, preços, itens do pedido), às vezes vem em texto corrido em vez de lista com quebras de linha ou marcadores.
- **Boa exceção:** O resumo final do pedido (Heineken, Original, Amstel + total em negrito) está bem estruturado — esse padrão deveria ser usado em outras respostas com múltiplos itens ou valores.

### 1.5 Falta de consolidação em sequência de mensagens

- **O que acontece:** O usuário manda em sequência: “2 cx heineken” → “4 de original” → “2 de amstel”. O agente responde primeiro só sobre 4 Original (preços), depois só sobre 2 Amstel (preços), ignorando as 2 Heineken na primeira resposta.
- **Impacto:** Parece que “esqueceu” parte do pedido; o cliente precisa perguntar de novo (“qual valor do pedido total?”) para juntar tudo.
- **Ideal:** Uma única resposta consolidando os três itens e o próximo passo (ex.: forma de pagamento para fechar o total).

### 1.6 Saudações e despedidas longas

- **Saudação:** “Olá! Como posso ajudar você hoje? Se desejar, posso fornecer informações sobre nossos produtos, preços ou condições de pagamento.” — longo para um “ola”.
- **Despedida:** “Perfeito! Se precisar de mais informações ou desejar fazer um pedido, estou à disposição. Obrigado por entrar em contato com o Galpão Continental. Tenha um ótimo dia!” — várias frases quando uma já basta.
- **Impacto:** Em canal rápido (WhatsApp), soa formal e “enrolado”.

### 1.7 Confusão de termos

- **Exemplo:** “bebidas quentes” (no contexto de cerveja/distribuidor) — em português costuma ser café/chá; aqui parece ter sido usado para “destilados” ou “outras bebidas”. Pode confundir o cliente.

---

## 2. Sugestões de mudança (antes de implementar)

### 2.1 Regras globais de estilo (aplicáveis a todos os tenants)

Incluir em um **bloco fixo de diretrizes** (system prompt base ou “comportamento padrão”) que seja sempre injetado, independente da configuração do tenant:

- **Fechamento:** Não terminar toda mensagem com “Posso ajudar com mais alguma coisa?”. Usar no máximo 1 vez a cada 2–3 trocas ou só quando fizer sentido (ex.: após um tópico fechado). Variar: “Quer saber mais alguma coisa?”, “Precisa de mais alguma informação?” ou simplesmente não fechar com pergunta.
- **Quando não souber:** Uma única fórmula curta, por exemplo: “Isso depende do pedido/região. O melhor é confirmar pelo telefone ou WhatsApp da loja.” Evitar repetir “recomendo consultar diretamente conosco” em todas as respostas.
- **Estrutura da resposta:**
  - Resposta direta primeiro (uma frase ou duas).
  - Se houver lista (preços, produtos, itens): usar quebras de linha e, quando fizer sentido, marcadores ou negrito para valores totais.
  - Pergunta ou oferta de ajuda só no final, e nem sempre.
- **Concisão:** Saudação a “ola” = uma linha (“Olá! Em que posso ajudar?”). Despedida = uma linha (“Qualquer coisa, estamos à disposição. Bom dia!”).
- **Pedidos em sequência:** Se o usuário enviar várias mensagens seguidas com itens (ex.: 2 heineken, 4 original, 2 amstel), responder uma vez consolidando todos os itens e o próximo passo (ex.: “Anotado: 2 Heineken, 4 Original, 2 Amstel. Qual forma de pagamento? Assim fecho o total.”).

### 2.2 Organização visual das respostas

- **Preços:** Sempre em linhas separadas; total em negrito quando houver mais de um item.
- **Lista de produtos/opções:** Com quebra de linha; evitar tudo em uma frase só.
- **Resumo de pedido:** Manter o padrão já usado no fim da conversa (itens + valor por item + **total**); usar esse mesmo padrão em qualquer confirmação de pedido.

### 2.3 Onde implementar

| Onde | O que |
|------|--------|
| **Prompt base do agente (n8n ou backend)** | Bloco fixo “Diretrizes de comportamento” com: anti-repetição de fechamento, resposta estruturada (resposta direta → lista → pergunta opcional), consolidação de mensagens seguidas, concisão em saudação/despedida. |
| **Montagem do system message** | Se o system message for montado (ex.: conhecimento do tenant + objetivo + diretrizes), acrescentar sempre esse bloco de diretrizes após o conteúdo do tenant, para que o tenant não precise saber escrever isso. |
| **Placeholder / ajuda no onboarding** | No campo “Diretrizes de resposta” (ou equivalente), sugerir exemplos curtos: “Seja direto. Use listas para preços. Não repita a mesma pergunta de fechamento em toda mensagem.” |
| **Simulador (agent-simulate)** | Usar as mesmas regras no prompt da simulação, para o tenant ver o comportamento melhorado antes de publicar. |

### 2.4 O que NÃO mudar

- Conteúdo específico do tenant (preços, produtos, endereço, horário) continua vindo da base de conhecimento/configuração do tenant.
- Objetivo e tom (ex.: “qualificar lead”, “vender”, “marcar reunião”) continuam definidos pelo tenant; as mudanças são só em **como** responder (repetição, estrutura, comprimento), não no **o quê**.

---

## 3. Resumo para o time

- **Problemas:** Fechamento repetitivo (“Posso ajudar com mais alguma coisa?”), “consulte conosco” em excesso, respostas em bloco único, listas pouco legíveis, não consolidar itens enviados em sequência, saudação/despedida longas.
- **Solução:** Adicionar um conjunto fixo de “diretrizes de comportamento” (prompt) que todos os agentes sigam: menos repetição, resposta direta + estrutura (listas, negrito para totais), consolidação de pedidos em sequência, saudações/despedidas curtas.
- **Onde:** No system message base do agente (n8n ou onde o prompt for montado) e, se existir, no agent-simulate; opcionalmente dicas no onboarding.
- **Próximo passo:** Validar estas sugestões com você e só então implementar (alterando o prompt base e/ou a montagem do system message conforme a arquitetura atual do SaaS).
