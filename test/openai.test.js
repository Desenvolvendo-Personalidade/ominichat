import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAIClient, ROUTING_RULES } from '../src/openai.js'

function fakeFetch(responses) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    const r = responses.shift()
    return { ok: r.status === 200, status: r.status, json: async () => r.body }
  }
  fn.calls = calls
  return fn
}

const okBody = {
  choices: [{ message: { content: JSON.stringify({ resposta: 'Olá!', acao: 'responder', motivo: 'nenhum' }) } }],
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
}

test('envia prompt + regras fixas + histórico e devolve decisão e tokens', async () => {
  const f = fakeFetch([{ status: 200, body: okBody }])
  const ai = createOpenAIClient({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', fetchImpl: f })
  const out = await ai.decide({ model: 'gpt-5-mini', reasoningEffort: 'minimal', systemPrompt: 'P', history: [{ role: 'user', content: 'oi' }] })

  assert.deepEqual(out.usage, { prompt: 50, completion: 10, total: 60 })
  assert.equal(out.decision.acao, 'responder')
  const sent = f.calls[0]
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(sent.headers.Authorization, 'Bearer sk-test')
  assert.equal(sent.body.messages[0].content, 'P' + ROUTING_RULES)
  assert.equal(sent.body.messages[1].content, 'oi')
  assert.equal(sent.body.reasoning_effort, 'minimal')
  assert.equal(sent.body.response_format.type, 'json_schema')
})

test('modelo que não aceita reasoning_effort: tenta de novo sem ele', async () => {
  const f = fakeFetch([
    { status: 400, body: { error: { message: 'Unsupported parameter', param: 'reasoning_effort' } } },
    { status: 200, body: okBody },
  ])
  const ai = createOpenAIClient({ apiKey: 'k', baseUrl: 'x', fetchImpl: f })
  await ai.decide({ model: 'gpt-4.1-mini', reasoningEffort: 'minimal', systemPrompt: 'P', history: [] })
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].body.reasoning_effort, undefined)
})

test('erro da OpenAI ou resposta inválida gera exceção (bot transfere)', async () => {
  const ai1 = createOpenAIClient({ apiKey: 'k', baseUrl: 'x', fetchImpl: fakeFetch([{ status: 429, body: { error: { message: 'quota' } } }]) })
  await assert.rejects(ai1.decide({ model: 'm', systemPrompt: 'P', history: [] }), e => e.status === 429)

  const bad = { choices: [{ message: { content: '{"foo":1}' } }] }
  const ai2 = createOpenAIClient({ apiKey: 'k', baseUrl: 'x', fetchImpl: fakeFetch([{ status: 200, body: bad }]) })
  await assert.rejects(ai2.decide({ model: 'm', systemPrompt: 'P', history: [] }))

  const ai3 = createOpenAIClient({ apiKey: '', baseUrl: 'x', fetchImpl: fakeFetch([]) })
  await assert.rejects(ai3.decide({ model: 'm', systemPrompt: 'P', history: [] }), /OPENAI_API_KEY/)
})

test('lista modelos: marca gratuitos, contexto e suporte a JSON; gratuitos primeiro', async () => {
  const data = [
    { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', context_length: 400000, pricing: { prompt: '0.00000025', completion: '0.000002' }, supported_parameters: ['response_format'] },
    { id: 'meta/llama:free', name: 'Llama (free)', context_length: 128000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'zeta/z', name: 'Zeta', pricing: { prompt: '0', completion: '0' } },
  ]
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ data }) } }
  const ai = createOpenAIClient({ apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', fetchImpl })
  const list = await ai.listModels()
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models')
  assert.equal(calls[0].headers.Authorization, 'Bearer k')
  assert.deepEqual(list, [
    { id: 'meta/llama:free', nome: 'Llama (free)', gratuito: true, contexto: 128000, json: false },
    { id: 'zeta/z', nome: 'Zeta', gratuito: true, contexto: null, json: null },
    { id: 'openai/gpt-5-mini', nome: 'GPT-5 Mini', gratuito: false, contexto: 400000, json: true },
  ])
})

test('lista modelos sem preço (OpenAI direta): gratuito fica desconhecido', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'gpt-5-mini' }] }) })
  const ai = createOpenAIClient({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', fetchImpl })
  assert.deepEqual(await ai.listModels(), [{ id: 'gpt-5-mini', nome: 'gpt-5-mini', gratuito: null, contexto: null, json: null }])
})
