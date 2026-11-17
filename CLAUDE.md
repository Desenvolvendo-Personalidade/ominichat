# CLAUDE.md — Ominichat

Guia para agentes de IA que trabalham neste repositório. Registra as decisões já tomadas
para não serem rediscutidas nem desfeitas sem pedido explícito do usuário.

## O que é

Agente de IA que atende clientes no **WhatsApp via Canais Abertos do Bitrix24**, usando a
**API da OpenAI**. Dono: Desenvolvendo Personalidade (clínica multidisciplinar em Santo
André/SP — psicologia, neuropsicologia, nutrição, avaliações, programas corporativos).

Objetivo em duas fases:

1. **Uso próprio (agora):** substituir o bot atual ("Deise") e evitar custo de ferramentas
   como o GPT Maker.
2. **Produto (depois):** vender para outras empresas, no estilo GPT Maker (sem ser cópia):
   multiempresa, painel do cliente, créditos e cobrança.

"Ominichat" é o nome do repositório. O nome comercial ainda não foi decidido; existe uma
empresa brasileira "Omnichat" no mesmo segmento, então checar o INPI antes de usar como marca.

## Comandos

```bash
npm test          # testes (node --test), 34 testes
npm run preview   # só a tela de configuração, sem buscar mensagens (porta 3000)
npm start         # bot completo (exige BOT_VIBE_KEY, BOT_ID, OPENAI_API_KEY)
```

Node >= 22, ES modules, sem dependências externas.

## Estado atual (protótipo)

- `src/main.js` — sobe a tela de configuração e um **laço de polling** que busca eventos no
  VibeCode a cada 3 s.
- `src/vibe.js` — cliente da API **VibeCode** (`https://vibecode.bitrix24.com/v1`, header
  `X-Api-Key`): eventos, enviar mensagem, transferir para operador, notificar usuário.
- `src/bot.js` — lógica do atendimento (eventos `ONIMBOTV2MESSAGEADD` / `ONIMBOTV2JOINCHAT`).
- `src/openai.js` — chamada à OpenAI que devolve `{ decision: { acao, motivo, resposta }, usage }`.
- `src/detect.js` — detecção de crise, pedido de humano e mascaramento de dados pessoais.
- `src/store.js` — persistência em **arquivos JSON** em `DATA_DIR` (settings, estado, log).
- `src/web.js` + `src/page.html` — tela de configuração (**sem login hoje**).
- `src/config.js` — variáveis de ambiente, prompt padrão, mensagem de crise, configurações padrão.

## Regras que NÃO podem ser quebradas

1. **Protocolo de crise:** mensagem com risco à vida → mensagem do CVV (188) / SAMU (192),
   transferência imediata, alerta urgente à equipe e, por 30 dias, o cliente vai direto
   para um humano. Funciona **mesmo com o bot desligado**. O texto `CRISIS_MESSAGE` fica no
   código de propósito (texto de segurança revisado); não mover para a tela de configuração.
2. **Nunca orientação clínica:** o bot trata só de assuntos administrativos (serviços,
   formatos, encaminhamento para agendamento). Nunca diagnóstico, opinião clínica, preços ou
   horários inventados.
3. **Dados pessoais:** mascarar (`redactPII`) antes de enviar à OpenAI. Nunca registrar CPF,
   telefone, e-mail etc. em log. É dado de saúde (LGPD art. 11).
4. **Idempotência:** o Bitrix pode reenviar o mesmo evento; ignorar mensagem já vista pelo ID.
5. **Na dúvida, transferir:** falha da OpenAI, falha de envio, mídia sem texto, pedido do
   cliente → mensagem de transferência + operador. Falha na transferência → alerta à equipe.
6. **Segredos só no servidor:** chaves em variáveis de ambiente, nunca no código nem no git
   (`.env` e `.env.*` estão no `.gitignore`).

## Decisões de arquitetura (já tomadas)

- **Hospedagem: Vercel + Supabase**, como o outro sistema do usuário (Persona+), em projetos
  **separados** do Persona+. **Não** usar o Vibe+ / VibeCode do Bitrix como plataforma: ele
  prende o produto ao Bitrix e não reduz o custo principal, que são os tokens de IA.
- **Integração:** o bot é um **chatbot registrado no Bitrix** e escolhido em Canais Abertos →
  Configurar → Chatbots. O WhatsApp já chega aos Canais Abertos por um conector com a **API
  oficial da Meta**; o bot não fala com a Meta diretamente.
- **IA:** OpenAI, **modelo econômico por padrão** (hoje `gpt-5-mini`, reasoning `minimal`).
  Manter a chamada atrás de uma camada de "provedor" para trocar modelo/fornecedor por
  configuração (inclusive por cliente, na fase de produto).
- **Custo estimado:** ~3.000 mensagens/mês → poucos dólares a algumas dezenas de dólares por
  mês com modelo econômico. Registrar os tokens de cada resposta (já feito em `usage`) — será
  a base da cobrança por créditos na fase de produto.
- **Base de conhecimento (futuro):** pedaços de documento com embeddings no Supabase
  (pgvector); enviar só os trechos relevantes, nunca a base inteira.

## Plano de etapas

Cada etapa: mostrar o plano ao usuário e esperar o OK antes de editar.

1. ~~Repositório no GitHub~~ — feito (`Desenvolvendo-Personalidade/ominichat`).
2. **Webhook em vez de polling:** trocar `vibe.js` pela API REST nativa do Bitrix24 (aplicação
   local com escopos `imbot`, `imopenlines`, `crm`; registro com `imbot.register` tipo Canais
   Abertos; eventos de mensagem por webhook; respostas com `imbot.message.add`; transferência
   com `imopenlines.bot.session.operator` / `imopenlines.bot.session.transfer`). O webhook
   responde OK rápido e processa em seguida. Manter `bot.js` e os testes o mais intactos
   possível. Confirmar nos docs oficiais do Bitrix os nomes exatos de eventos e métodos.
3. **Supabase em vez de arquivos:** `store.js` passa a usar tabelas (configurações, estado
   das conversas, mensagens vistas, log de uso). RLS ligado em toda tabela.
4. **Login na tela de configuração e publicação na Vercel.** Testar num **Canal Aberto de
   teste** com número próprio antes de trocar a "Deise" no canal real.

Depois: ações no CRM (criar/atualizar lead e negócio, etapa do funil), base de conhecimento,
e a fase de produto (multiempresa, painel, créditos, cobrança via Asaas, app no Bitrix24 Market).

## Cuidados

- **Nunca dois bots no mesmo canal:** se o protótipo estiver rodando em algum lugar, ele
  disputa os eventos com a versão nova. Confirmar com o usuário antes de ativar qualquer versão.
- **Configuração "transferir depois de X minutos"** no Bitrix (hoje 3 min): para uma IA que
  conversa, o normal é não transferir por tempo e deixar o bot transferir pela API. Testar no
  canal de teste antes de mudar em produção.
- **Limite de tempo da Vercel:** não fazer o Bitrix esperar a resposta da IA dentro do webhook.

## Forma de trabalhar com o usuário

- Responder em português, linguagem simples e direta.
- Mostrar o plano e esperar o OK antes de editar; não refatorar além do pedido.
- "Commitar e enviar" = push direto na `main`, depois de rodar os testes.
