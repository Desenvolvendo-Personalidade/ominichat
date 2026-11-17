import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/store.js'
import { createBot } from '../src/bot.js'

export function tempStore(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olbot-'))
  const store = createStore(dir)
  store.updateSettings({ alertUserIds: '7, 9', ...settings })
  return store
}

export function fakeVibe({ failTransfer = false, failSend = false } = {}) {
  const calls = []
  return {
    calls,
    async sendMessage(dialogId, message, keyboard) {
      calls.push({ fn: 'sendMessage', dialogId, message, keyboard })
      if (failSend) throw new Error('send failed')
      return { id: 1 }
    },
    async handToOperator(chatId) {
      calls.push({ fn: 'handToOperator', chatId })
      if (failTransfer) throw new Error('transfer failed')
      return { transferred: true }
    },
    async transferToUser(chatId, userId) {
      calls.push({ fn: 'transferToUser', chatId, userId })
      return { transferred: true }
    },
    async notifyUser(userId, message) {
      calls.push({ fn: 'notifyUser', userId, message })
      return {}
    },
    async listOpenlines() {
      return [{ id: 3, name: 'Teste' }]
    },
  }
}

export function fakeAI(reply) {
  const calls = []
  return {
    calls,
    async decide(args) {
      calls.push(args)
      if (reply instanceof Error) throw reply
      const decision = typeof reply === 'function' ? reply(args) : reply
      return { decision, usage: { prompt: 100, completion: 20, total: 120 } }
    },
  }
}

export const ANSWER = { resposta: 'Olá! Sou o assistente virtual. Atendemos presencial e online.', acao: 'responder', motivo: 'nenhum' }

let nextId = 1000
export function msgEvent(text, { chatId = 55, lineId = 3, entityType = 'LINES', authorId = 500, isSystem = false, id } = {}) {
  return {
    eventId: nextId,
    type: 'ONIMBOTV2MESSAGEADD',
    data: {
      bot: { id: 42 },
      message: { id: id ?? nextId++, text, authorId, isSystem },
      chat: { id: chatId, dialogId: `chat${chatId}`, entityType, entityId: `livechat|${lineId}|1|99` },
      user: { id: authorId },
    },
  }
}

export function joinEvent({ chatId = 55, lineId = 3 } = {}) {
  return {
    eventId: nextId++,
    type: 'ONIMBOTV2JOINCHAT',
    data: { bot: { id: 42 }, chat: { id: chatId, dialogId: `chat${chatId}`, entityType: 'LINES', entityId: `livechat|${lineId}|1|99` } },
  }
}

export function setup({ settings, reply = ANSWER, vibeOpts, now } = {}) {
  const store = tempStore(settings)
  const vibe = fakeVibe(vibeOpts)
  const ai = fakeAI(reply)
  const logger = { error() {}, warn() {}, log() {} }
  const bot = createBot({ store, vibe, ai, logger, ...(now ? { now } : {}) })
  return { store, vibe, ai, bot }
}
