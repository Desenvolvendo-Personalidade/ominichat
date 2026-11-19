import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createWebServer } from '../src/web.js'
import { tempStore, fakeVibe } from './helpers.js'

let server, base, port, store
const events = []
let modelCalls = 0
const SECRET = 'segredo-de-teste-123'

before(async () => {
  store = tempStore()
  server = createWebServer({
    store,
    vibe: fakeVibe(),
    status: () => ({ ok: 1 }),
    onEvent: async ev => events.push(ev),
    webhookSecret: SECRET,
    listModels: async () => { modelCalls++; return [{ id: 'x/y:free', nome: 'Y', gratuito: true, contexto: 1000, json: true }] },
    logger: { error() {} },
  })
  await new Promise(r => server.listen(0, r))
  port = server.address().port
  base = `http://127.0.0.1:${port}`
})
after(() => server.close())

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// Simula um acesso vindo da internet / de um túnel (Host diferente de localhost).
function remote(path, { method = 'GET', body, type } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { Host: 'bot.exemplo.com', ...(type ? { 'Content-Type': type } : {}) } },
      res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const form = (secret, fields) =>
  remote(`/bitrix/eventos?s=${secret}`, { method: 'POST', type: 'application/x-www-form-urlencoded', body: new URLSearchParams(fields).toString() })

test('saúde responde 200', async () => {
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('pela internet a tela de configuração fica bloqueada', async () => {
  assert.equal((await remote('/')).status, 403)
  assert.equal((await remote('/api/state')).status, 403)
  assert.equal((await remote('/api/enabled', { method: 'POST', type: 'application/json', body: '{"enabled":false}' })).status, 403)
  assert.equal(store.getSettings().enabled, true)
})

test('no próprio computador vê a página e o estado, sem chaves', async () => {
  const page = await fetch(base + '/')
  assert.match(await page.text(), /Bot de IA/)
  const json = await (await fetch(base + '/api/state')).json()
  assert.equal(json.settings.model, 'gpt-5-mini')
  assert.deepEqual(json.linhas, [{ id: '3', nome: 'Teste' }])
  assert.doesNotMatch(JSON.stringify(json), /sk-|rest\/\d+\//)
})

test('liga/desliga e registra no log', async () => {
  assert.equal((await post('/api/enabled', { enabled: false })).status, 200)
  assert.equal(store.getSettings().enabled, false)
  assert.equal(store.readLog()[0].evento, 'bot_desligado')
  await post('/api/enabled', { enabled: true })
  assert.equal(store.getSettings().enabled, true)
})

test('salva prompt e modelo; rejeita valores inválidos', async () => {
  assert.equal((await post('/api/settings', { systemPrompt: 'Novo prompt de sistema editado.', model: 'gpt-5-nano' })).status, 200)
  assert.equal(store.getSettings().systemPrompt, 'Novo prompt de sistema editado.')
  assert.equal(store.getSettings().model, 'gpt-5-nano')
  assert.equal((await post('/api/settings', { alertUserIds: 'abc' })).status, 400)
  assert.equal((await post('/api/settings', { enabled: false, foo: 1 })).status, 200)
  assert.equal(store.getSettings().enabled, true, 'enabled só muda pelo botão')
})

test('aviso do Bitrix com o segredo certo é aceito e convertido', async () => {
  events.length = 0
  const res = await form(SECRET, {
    event: 'ONIMBOTV2MESSAGEADD',
    'data[bot][id]': '42',
    'data[message][id]': '900',
    'data[message][text]': 'Olá',
    'data[message][isSystem]': '0',
    'data[chat][id]': '55',
    'data[chat][dialogId]': 'chat55',
    'data[chat][entityType]': 'LINES',
    'auth[application_token]': 'x',
  })
  assert.equal(res.status, 200)
  await new Promise(r => setTimeout(r, 20))
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'ONIMBOTV2MESSAGEADD')
  assert.equal(events[0].data.message.text, 'Olá')
  assert.equal(events[0].data.message.isSystem, false)
  assert.equal(events[0].data.chat.dialogId, 'chat55')
})

test('aviso sem o segredo ou com segredo errado é recusado', async () => {
  events.length = 0
  assert.equal((await form('errado', { event: 'ONIMBOTV2MESSAGEADD' })).status, 403)
  assert.equal((await remote('/bitrix/eventos', { method: 'POST', body: 'event=ONIMBOTV2MESSAGEADD' })).status, 403)
  assert.equal(events.length, 0)
})

test('lista de modelos: guardada por 1 hora, atualiza sob pedido e não expõe chaves', async () => {
  modelCalls = 0
  const a = await (await fetch(base + '/api/modelos')).json()
  await fetch(base + '/api/modelos')
  assert.equal(modelCalls, 1)
  assert.deepEqual(a.modelos, [{ id: 'x/y:free', nome: 'Y', gratuito: true, contexto: 1000, json: true }])
  await fetch(base + '/api/modelos?atualizar=1')
  assert.equal(modelCalls, 2)
  assert.doesNotMatch(JSON.stringify(a), /sk-|Bearer/)
  assert.equal((await remote('/api/modelos')).status, 403)
})
