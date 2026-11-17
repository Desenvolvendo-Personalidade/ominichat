import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createWebServer } from '../src/web.js'
import { tempStore, fakeVibe } from './helpers.js'

let server, base, store
const ADMIN = { 'x-vibe-request-id': 'r1', 'x-vibe-user-role': 'ADMIN', 'x-vibe-user-id': '1', 'x-vibe-user-name': 'Kaike' }

before(async () => {
  store = tempStore()
  server = createWebServer({ store, vibe: fakeVibe(), status: () => ({ ok: 1 }) })
  await new Promise(r => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const post = (path, body, headers = ADMIN) =>
  fetch(base + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('saúde e checagem interna respondem 200', async () => {
  assert.equal((await fetch(base + '/health')).status, 200)
  assert.equal((await fetch(base + '/')).status, 200)
})

test('quem não é administrador não acessa a configuração', async () => {
  const member = { ...ADMIN, 'x-vibe-user-role': 'MEMBER' }
  assert.equal((await fetch(base + '/api/state', { headers: member })).status, 403)
  assert.equal((await post('/api/enabled', { enabled: false }, member)).status, 403)
  assert.equal(store.getSettings().enabled, true)
})

test('administrador vê a página e o estado, sem chaves', async () => {
  const page = await fetch(base + '/', { headers: ADMIN })
  assert.match(await page.text(), /Bot de IA/)
  const res = await fetch(base + '/api/state', { headers: ADMIN })
  const json = await res.json()
  assert.equal(json.settings.model, 'gpt-5-mini')
  assert.deepEqual(json.linhas, [{ id: '3', nome: 'Teste' }])
  assert.doesNotMatch(JSON.stringify(json), /vibe_api_|sk-/)
})

test('liga/desliga e registra quem fez', async () => {
  assert.equal((await post('/api/enabled', { enabled: false })).status, 200)
  assert.equal(store.getSettings().enabled, false)
  assert.equal(store.readLog()[0].evento, 'bot_desligado')
  assert.match(store.readLog()[0].por, /Kaike/)
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
