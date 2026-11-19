// Chamada à API da OpenAI (Chat Completions) com resposta estruturada em JSON.

const DECISION_SCHEMA = {
  name: 'decisao_atendimento',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      resposta: { type: 'string', description: 'Texto a enviar ao cliente, em português.' },
      acao: { type: 'string', enum: ['responder', 'transferir'] },
      motivo: { type: 'string', enum: ['nenhum', 'pedido_cliente', 'nao_sabe', 'clinico', 'crise'] },
    },
    required: ['resposta', 'acao', 'motivo'],
  },
}

// Regras fixas acrescentadas ao prompt editável. Garantem o protocolo de transferência
// mesmo que alguém apague essas instruções do prompt na tela de configuração.
export const ROUTING_RULES = `

REGRAS DE ENCAMINHAMENTO (obrigatórias):
Responda sempre no formato JSON pedido, com os campos "resposta", "acao" e "motivo".
- acao "transferir", motivo "crise": qualquer sinal de risco à vida — ideação suicida, vontade de morrer, autolesão, violência sofrida ou intenção de ferir alguém. Na dúvida, trate como crise.
- acao "transferir", motivo "clinico": a pessoa pede ou descreve algo clínico (sintomas, sofrimento emocional, diagnóstico, medicação, orientação psicológica ou nutricional).
- acao "transferir", motivo "pedido_cliente": a pessoa pede para falar com um humano, atendente ou alguém da equipe.
- acao "transferir", motivo "nao_sabe": você não tem a informação para responder com segurança (preços, horários, disponibilidade, convênios ou qualquer dado que não esteja nestas instruções).
- acao "responder", motivo "nenhum": dúvida administrativa que você consegue responder com as informações acima.
Quando transferir, "resposta" deve ser uma frase curta e acolhedora avisando que alguém da equipe vai continuar o atendimento.`

export function createOpenAIClient({ apiKey, baseUrl, fetchImpl = fetch }) {
  async function request(body) {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(json.error?.message || `OpenAI HTTP ${res.status}`)
      err.status = res.status
      err.param = json.error?.param
      throw err
    }
    return json
  }

  return {
    // Lista os modelos do provedor. No OpenRouter vem com preço: gratuito = entrada e saída a zero.
    // Retorna [{ id, nome, gratuito, contexto, json }] (gratuito/json = null quando o provedor não informa).
    async listModels() {
      const res = await fetchImpl(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(20_000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error?.message || `Lista de modelos: HTTP ${res.status}`)
      return (json.data || [])
        .filter(m => m && typeof m.id === 'string')
        .map(m => {
          const p = m.pricing
          const gratuito = m.id.endsWith(':free') || (p ? Number(p.prompt) === 0 && Number(p.completion) === 0 : null)
          const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : null
          return {
            id: m.id,
            nome: m.name || m.id,
            gratuito: p || m.id.endsWith(':free') ? gratuito : null,
            contexto: Number(m.context_length) || null,
            json: params ? params.includes('response_format') || params.includes('structured_outputs') : null,
          }
        })
        .sort((a, b) => Number(Boolean(b.gratuito)) - Number(Boolean(a.gratuito)) || a.nome.localeCompare(b.nome))
    },

    // Retorna { decision: {resposta, acao, motivo}, usage: {prompt, completion, total} }
    async decide({ model, reasoningEffort, systemPrompt, history }) {
      if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')
      const body = {
        model,
        messages: [{ role: 'system', content: systemPrompt + ROUTING_RULES }, ...history],
        response_format: { type: 'json_schema', json_schema: DECISION_SCHEMA },
      }
      if (reasoningEffort) body.reasoning_effort = reasoningEffort

      let json
      try {
        json = await request(body)
      } catch (err) {
        // Modelos sem raciocínio recusam reasoning_effort: tenta de novo sem ele.
        if (err.status === 400 && body.reasoning_effort && /reasoning/i.test(`${err.param} ${err.message}`)) {
          delete body.reasoning_effort
          json = await request(body)
        } else {
          throw err
        }
      }

      const content = json.choices?.[0]?.message?.content
      const decision = JSON.parse(content)
      if (typeof decision.resposta !== 'string' || !['responder', 'transferir'].includes(decision.acao)) {
        throw new Error('Resposta da OpenAI em formato inesperado')
      }
      return {
        decision,
        usage: {
          prompt: json.usage?.prompt_tokens ?? 0,
          completion: json.usage?.completion_tokens ?? 0,
          total: json.usage?.total_tokens ?? 0,
        },
      }
    },
  }
}
