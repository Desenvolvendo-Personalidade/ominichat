import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBitrixClient } from '../src/bitrix.js'
import { parseFormBody, toBotEvent, validSecret } from '../src/webhook.js'

function fakeFetch(response = { result: true }, status = 200) {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: status < 400, status, json: async () => response }
  }
  return { calls, fetchImpl }
}

const opts = { webhookUrl: 'https://empresa.bitrix24.com.br/rest/1/abc', botId: 42, botToken: 'tok' }

test('envia mensagem pelo imbot.v2 com botId, botToken e teclado', async () => {
  const f = fakeFetch({ result: { id: 789 } })
  const bitrix = createBitrixClient({ ...opts, fetchImpl: f.fetchImpl })
  const kb = [{ TEXT: 'Falar com um atendente', ACTION: 'SEND', ACTION_VALUE: '/operador' }]
  assert.deepEqual(await bitrix.sendMessage('chat55', 'Oi', kb), { id: 789 })
  assert.equal(f.calls[0].url, 'https://empresa.bitrix24.com.br/rest/1/abc/imbot.v2.Chat.Message.send')
  assert.deepEqual(f.calls[0].body, { botId: 42, botToken: 'tok', dialogId: 'chat55', fields: { message: 'Oi', keyboard: kb } })
})

test('transferências e alerta usam os métodos certos', async () => {
  const f = fakeFetch()
  const bitrix = createBitrixClient({ ...opts, fetchImpl: f.fetchImpl })
  await bitrix.handToOperator('55')
  await bitrix.transferToUser('55', '7')
  await bitrix.notifyUser('9', 'alerta')
  assert.deepEqual(
    f.calls.map(c => [c.url.split('/').pop(), c.body]),
    [
      ['imopenlines.bot.session.operator', { CHAT_ID: 55, CLIENT_ID: 'tok' }],
      ['imopenlines.bot.session.transfer', { CHAT_ID: 55, USER_ID: 7, LEAVE: 'Y', CLIENT_ID: 'tok' }],
      ['im.notify.system.add', { USER_ID: 9, MESSAGE: 'alerta' }],
    ],
  )
})

test('lista os Canais Abertos no formato da tela', async () => {
  const f = fakeFetch({ result: [{ ID: '3', LINE_NAME: '0800' }] })
  const bitrix = createBitrixClient({ ...opts, fetchImpl: f.fetchImpl })
  assert.deepEqual(await bitrix.listOpenlines(), [{ id: '3', name: '0800' }])
})

test('erro do Bitrix vira exceção (para o bot transferir/alertar)', async () => {
  const f = fakeFetch({ error: 'WRONG_CHAT', error_description: 'Operator is not a bot' }, 400)
  const bitrix = createBitrixClient({ ...opts, fetchImpl: f.fetchImpl })
  await assert.rejects(bitrix.handToOperator('55'), err => err.code === 'WRONG_CHAT' && err.status === 400)
  const f2 = fakeFetch({ error: 'QUERY_LIMIT_EXCEEDED' }, 200)
  await assert.rejects(createBitrixClient({ ...opts, fetchImpl: f2.fetchImpl }).notifyUser(1, 'x'))
})

test('converte o formulário do Bitrix (chaves estilo PHP) em objeto', () => {
  const body = parseFormBody('event=ONIMBOTV2JOINCHAT&data%5Bchat%5D%5Bid%5D=55&data%5Bchat%5D%5BentityType%5D=LINES&auth%5Bdomain%5D=x.bitrix24.com.br')
  assert.deepEqual(body, { event: 'ONIMBOTV2JOINCHAT', data: { chat: { id: '55', entityType: 'LINES' } }, auth: { domain: 'x.bitrix24.com.br' } })
  assert.deepEqual(toBotEvent(body), { type: 'ONIMBOTV2JOINCHAT', data: { chat: { id: '55', entityType: 'LINES' } } })
})

test('formulário malicioso não altera protótipos', () => {
  const body = parseFormBody('__proto__%5Bx%5D=1&data%5B__proto__%5D%5By%5D=2&a=1')
  assert.deepEqual(body, { a: '1' })
  assert.equal({}.x, undefined)
  assert.equal({}.y, undefined)
})

test('isSystem "1" vira true; mensagem de sistema é reconhecida', () => {
  assert.equal(toBotEvent({ event: 'E', data: { message: { isSystem: '1' } } }).data.message.isSystem, true)
  assert.equal(toBotEvent({ event: 'E', data: { message: { isSystem: '0' } } }).data.message.isSystem, false)
})

test('segredo: só o valor exato passa', () => {
  assert.equal(validSecret('abc', 'abc'), true)
  assert.equal(validSecret('abd', 'abc'), false)
  assert.equal(validSecret('ab', 'abc'), false)
  assert.equal(validSecret(null, 'abc'), false)
  assert.equal(validSecret('abc', ''), false)
})
