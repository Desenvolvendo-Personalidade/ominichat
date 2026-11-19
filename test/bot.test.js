import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, msgEvent, joinEvent, ANSWER } from './helpers.js'
import { CRISIS_MESSAGE } from '../src/config.js'

const fns = vibe => vibe.calls.map(c => c.fn)

test('mensagem comum: IA responde com botão de atendente e registra tokens', async () => {
  const { bot, vibe, ai, store } = setup()
  await bot.handleEvent(msgEvent('Vocês atendem online?'))

  assert.equal(ai.calls.length, 1)
  assert.deepEqual(fns(vibe), ['sendMessage'])
  assert.equal(vibe.calls[0].dialogId, 'chat55')
  assert.equal(vibe.calls[0].message, ANSWER.resposta)
  assert.equal(vibe.calls[0].keyboard[0].ACTION_VALUE, '/operador')

  const [entry] = store.readLog()
  assert.equal(entry.transferido, false)
  assert.equal(entry.tokens.total, 120)
  assert.equal(entry.modelo, 'gpt-5-mini')
  assert.ok(entry.data)
  assert.equal(JSON.stringify(entry).includes('online'), false, 'o texto do cliente não vai para o log')
})

test('ignora chats que não são de Canal Aberto, mensagens de sistema e do próprio bot', async () => {
  const { bot, vibe, ai } = setup()
  await bot.handleEvent(msgEvent('oi', { entityType: '' }))
  await bot.handleEvent(msgEvent('oi', { isSystem: true }))
  await bot.handleEvent(msgEvent('oi', { authorId: 42 }))
  await bot.handleEvent({ type: 'ONIMBOTV2REACTIONCHANGE', data: {} })
  assert.equal(ai.calls.length, 0)
  assert.equal(vibe.calls.length, 0)
})

test('a mesma mensagem entregue duas vezes é processada uma vez só', async () => {
  const { bot, ai } = setup()
  const ev = msgEvent('Quais serviços vocês têm?')
  await bot.handleEvent(ev)
  await bot.handleEvent(ev)
  assert.equal(ai.calls.length, 1)
})

test('só atende o Canal Aberto configurado', async () => {
  const { bot, ai } = setup({ settings: { lineId: '3' } })
  await bot.handleEvent(msgEvent('oi', { lineId: 1 }))
  assert.equal(ai.calls.length, 0)
  await bot.handleEvent(msgEvent('oi', { lineId: 3 }))
  assert.equal(ai.calls.length, 1)
})

test('cliente pede atendente: transfere sem chamar a IA e para de responder', async () => {
  const { bot, vibe, ai, store } = setup()
  await bot.handleEvent(msgEvent('Quero falar com um atendente'))
  assert.equal(ai.calls.length, 0)
  assert.deepEqual(fns(vibe), ['sendMessage', 'handToOperator'])
  assert.equal(vibe.calls[1].chatId, '55')
  assert.equal(store.readLog()[0].motivo, 'pedido_cliente')

  await bot.handleEvent(msgEvent('Alô?'))
  assert.equal(ai.calls.length, 0)
  assert.equal(vibe.calls.length, 2)
})

test('botão "Falar com um atendente" (/operador) transfere', async () => {
  const { bot, vibe, ai } = setup()
  await bot.handleEvent(msgEvent('/operador'))
  assert.equal(ai.calls.length, 0)
  assert.ok(fns(vibe).includes('handToOperator'))
})

for (const motivo of ['nao_sabe', 'clinico', 'pedido_cliente']) {
  test(`IA decide transferir (${motivo}): avisa o cliente e transfere`, async () => {
    const { bot, vibe, store } = setup({ reply: { resposta: 'Vou chamar alguém da equipe.', acao: 'transferir', motivo } })
    await bot.handleEvent(msgEvent('Quanto custa a avaliação neuropsicológica?'))
    assert.deepEqual(fns(vibe), ['sendMessage', 'handToOperator'])
    assert.equal(vibe.calls[0].keyboard, undefined)
    const [entry] = store.readLog()
    assert.equal(entry.transferido, true)
    assert.equal(entry.motivo, motivo)
    assert.equal(entry.tokens.total, 120)
  })
}

test('falha da OpenAI: mensagem educada, transfere e registra a falha', async () => {
  const err = Object.assign(new Error('Service unavailable'), { status: 503 })
  const { bot, vibe, store } = setup({ reply: err })
  await bot.handleEvent(msgEvent('Olá'))
  assert.deepEqual(fns(vibe), ['sendMessage', 'handToOperator'])
  assert.match(vibe.calls[0].message, /instabilidade/)
  assert.doesNotMatch(vibe.calls[0].message, /503|unavailable/i)
  const [entry] = store.readLog()
  assert.equal(entry.motivo, 'falha_openai')
  assert.equal(entry.transferido, true)
  assert.equal(entry.erro, '503')
})

test('CRISE por palavra-chave: CVV, transferência, alerta urgente e o bot para', async () => {
  const { bot, vibe, ai, store } = setup()
  await bot.handleEvent(msgEvent('Não aguento mais, estou pensando em me matar'))

  assert.equal(ai.calls.length, 0, 'não depende da OpenAI')
  assert.equal(vibe.calls[0].fn, 'sendMessage')
  assert.equal(vibe.calls[0].message, CRISIS_MESSAGE)
  assert.match(CRISIS_MESSAGE, /188/)
  assert.equal(vibe.calls[1].fn, 'handToOperator')
  const alerts = vibe.calls.filter(c => c.fn === 'notifyUser')
  assert.deepEqual(alerts.map(a => a.userId), ['7', '9'])
  assert.match(alerts[0].message, /URGENTE/)

  const [entry] = store.readLog()
  assert.equal(entry.motivo, 'crise')
  assert.equal(entry.urgente, true)
  assert.equal(entry.transferido, true)

  await bot.handleEvent(msgEvent('oi?'))
  assert.equal(ai.calls.length, 0)
  assert.equal(vibe.calls.length, 4)
})

test('CRISE detectada pela IA aciona o mesmo protocolo', async () => {
  const { bot, vibe, store } = setup({ reply: { resposta: '...', acao: 'transferir', motivo: 'crise' } })
  await bot.handleEvent(msgEvent('ninguém ia sentir minha falta se eu sumisse'))
  assert.equal(vibe.calls[0].message, CRISIS_MESSAGE)
  assert.ok(fns(vibe).includes('notifyUser'))
  assert.equal(store.readLog()[0].tokens.total, 120)
})

test('CRISE com usuário de crise configurado transfere direto para ele', async () => {
  const { bot, vibe } = setup({ settings: { crisisTransferUserId: '15' } })
  await bot.handleEvent(msgEvent('quero morrer'))
  const t = vibe.calls.find(c => c.fn === 'transferToUser')
  assert.equal(t.userId, '15')
  assert.ok(!fns(vibe).includes('handToOperator'))
})

test('CRISE com falha na transferência: alerta diz que a transferência falhou', async () => {
  const { bot, vibe, store } = setup({ vibeOpts: { failTransfer: true } })
  await bot.handleEvent(msgEvent('vou me cortar hoje'))
  const alert = vibe.calls.find(c => c.fn === 'notifyUser')
  assert.match(alert.message, /FALHOU/)
  assert.equal(store.readLog()[0].transferido, false)
})

test('bot desligado: transfere em silêncio, sem IA; crise ainda recebe o CVV', async () => {
  const { bot, vibe, ai, store } = setup({ settings: { enabled: false } })
  await bot.handleEvent(msgEvent('Bom dia', { chatId: 1 }))
  assert.equal(ai.calls.length, 0)
  assert.deepEqual(fns(vibe), ['handToOperator'])
  assert.equal(store.readLog()[0].motivo, 'bot_desligado')

  await bot.handleEvent(msgEvent('quero morrer', { chatId: 2 }))
  assert.ok(vibe.calls.some(c => c.message === CRISIS_MESSAGE))
})

test('usa no máximo as últimas 10 mensagens e remove dados pessoais', async () => {
  const { bot, ai } = setup()
  for (let i = 1; i <= 8; i++) await bot.handleEvent(msgEvent(`pergunta ${i}`))
  await bot.handleEvent(msgEvent('meu email é ana@exemplo.com e tel (11) 98765-4321'))
  const last = ai.calls.at(-1).history
  assert.equal(last.length, 10)
  assert.equal(last.at(-1).role, 'user')
  assert.doesNotMatch(last.at(-1).content, /ana@exemplo|98765/)
  assert.equal(last.filter(m => m.role === 'assistant').length, 5)
})

test('prompt editável e modelo da configuração são usados', async () => {
  const { bot, ai } = setup({ settings: { systemPrompt: 'Prompt de teste da clínica, editado pelo dono.', model: 'gpt-5-nano' } })
  await bot.handleEvent(msgEvent('oi'))
  assert.equal(ai.calls[0].systemPrompt, 'Prompt de teste da clínica, editado pelo dono.')
  assert.equal(ai.calls[0].model, 'gpt-5-nano')
})

test('nova sessão (bot entra de novo no chat) volta a atender depois de uma transferência', async () => {
  const { bot, ai } = setup()
  await bot.handleEvent(msgEvent('quero falar com um atendente'))
  await bot.handleEvent(joinEvent())
  await bot.handleEvent(msgEvent('Olá de novo'))
  assert.equal(ai.calls.length, 1)
})

test('cliente com crise recente vai direto para humano quando volta', async () => {
  const { bot, vibe, ai } = setup()
  await bot.handleEvent(msgEvent('quero me matar'))
  vibe.calls.length = 0
  await bot.handleEvent(joinEvent())
  assert.deepEqual(fns(vibe), ['handToOperator', 'notifyUser', 'notifyUser'])
  await bot.handleEvent(msgEvent('oi'))
  assert.equal(ai.calls.length, 0)
})

test('crise antiga (mais de 30 dias) não bloqueia nova sessão', async () => {
  let t = new Date('2026-01-01T10:00:00Z')
  const { bot, ai } = setup({ now: () => t })
  await bot.handleEvent(msgEvent('quero me matar'))
  t = new Date('2026-03-01T10:00:00Z')
  await bot.handleEvent(joinEvent())
  await bot.handleEvent(msgEvent('Quero agendar uma consulta'))
  assert.equal(ai.calls.length, 1)
})

test('áudio ou arquivo sem texto vai para atendente', async () => {
  const { bot, vibe, ai, store } = setup()
  await bot.handleEvent(msgEvent(''))
  assert.equal(ai.calls.length, 0)
  assert.ok(fns(vibe).includes('handToOperator'))
  assert.equal(store.readLog()[0].motivo, 'midia')
})

test('falha ao enviar a resposta: transfere para não deixar o cliente sem retorno', async () => {
  const { bot, vibe, store } = setup({ vibeOpts: { failSend: true } })
  await bot.handleEvent(msgEvent('oi'))
  assert.ok(fns(vibe).includes('handToOperator'))
  assert.equal(store.readLog()[0].motivo, 'falha_envio')
})

test('conversa reaberta: mensagem que chega ANTES do aviso de entrada é atendida', async () => {
  let t = new Date('2026-11-18T13:00:00Z')
  const { bot, ai } = setup({ now: () => t })
  await bot.handleEvent(msgEvent('quero falar com um atendente'))
  t = new Date('2026-11-19T13:58:00Z') // dia seguinte; o JOINCHAT ainda não chegou
  await bot.handleEvent(msgEvent('Oi, bom dia'))
  assert.equal(ai.calls.length, 1)
  await bot.handleEvent(joinEvent())
  await bot.handleEvent(msgEvent('Vocês atendem online?'))
  assert.equal(ai.calls.length, 2)
})

test('logo após transferir (menos de 2 min) o bot continua quieto', async () => {
  let t = new Date('2026-11-19T13:00:00Z')
  const { bot, ai, vibe } = setup({ now: () => t })
  await bot.handleEvent(msgEvent('quero falar com um atendente'))
  t = new Date('2026-11-19T13:01:30Z')
  await bot.handleEvent(msgEvent('alô?'))
  assert.equal(ai.calls.length, 0)
  assert.equal(vibe.calls.length, 2)
})

test('crise numa conversa marcada como "com uma pessoa" ainda recebe o CVV e o alerta', async () => {
  const { bot, vibe } = setup()
  await bot.handleEvent(msgEvent('quero falar com um atendente'))
  vibe.calls.length = 0
  await bot.handleEvent(msgEvent('não aguento mais, quero me matar'))
  assert.equal(vibe.calls[0].message, CRISIS_MESSAGE)
  assert.ok(fns(vibe).includes('notifyUser'))
})

test('crise recente: mensagem antes do aviso de entrada não vai para a IA', async () => {
  let t = new Date('2026-11-18T13:00:00Z')
  const { bot, ai } = setup({ now: () => t })
  await bot.handleEvent(msgEvent('quero me matar'))
  t = new Date('2026-11-25T13:00:00Z')
  await bot.handleEvent(msgEvent('oi'))
  assert.equal(ai.calls.length, 0)
})
