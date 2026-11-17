// Lógica do atendimento: decide se responde, transfere ou aciona o protocolo de crise.

import { CRISIS_MESSAGE, CRISIS_LOCK_DAYS, HISTORY_LIMIT } from './config.js'
import { isCrisis, isHumanRequest, redactPII } from './detect.js'

const DAY_MS = 24 * 60 * 60 * 1000

function lineIdOf(chat) {
  // entityId de um chat de Canal Aberto: "conector|idDaLinha|..."
  return String(chat?.entityId || '').split('|')[1] || ''
}

function splitIds(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s))
}

export function createBot({ store, vibe, ai, now = () => new Date(), logger = console }) {
  function log(entry) {
    store.appendLog({ data: now().toISOString(), ...entry })
  }

  async function safe(label, fn) {
    try {
      return await fn()
    } catch (err) {
      logger.error(`[${label}] ${err.code || ''} ${err.message}`)
      return { error: err }
    }
  }

  async function notifyAlerts(settings, message) {
    for (const userId of splitIds(settings.alertUserIds)) {
      await safe('notificacao', () => vibe.notifyUser(userId, message))
    }
  }

  async function handOff({ chatId, dialogId, settings, motivo, message, entry = {} }) {
    if (message) await safe('mensagem', () => vibe.sendMessage(dialogId, message))
    const result = await safe('transferir', () => vibe.handToOperator(chatId))
    const falhou = Boolean(result?.error)
    store.setChat(chatId, { mode: 'human', history: [], since: now().toISOString() })
    log({ chat: chatId, ...entry, transferido: !falhou, motivo, ...(falhou ? { erro: 'falha_transferencia' } : {}) })
    if (falhou) {
      await notifyAlerts(settings, `⚠️ O bot não conseguiu transferir o chat ${chatId} do Canal Aberto para um atendente. Verifique a conversa.`)
    }
  }

  async function crisis({ chatId, dialogId, settings, entry = {} }) {
    await safe('mensagem_crise', () => vibe.sendMessage(dialogId, CRISIS_MESSAGE))

    let result = { error: true }
    if (settings.crisisTransferUserId) {
      result = await safe('transferir_crise', () => vibe.transferToUser(chatId, settings.crisisTransferUserId))
    }
    if (result?.error) result = await safe('transferir', () => vibe.handToOperator(chatId))
    const falhou = Boolean(result?.error)

    store.setChat(chatId, { mode: 'crisis', history: [], crisisAt: now().toISOString() })
    log({ chat: chatId, ...entry, transferido: !falhou, motivo: 'crise', urgente: true, ...(falhou ? { erro: 'falha_transferencia' } : {}) })

    await notifyAlerts(
      settings,
      `🚨 URGENTE – Protocolo de crise no Canal Aberto.\nUm cliente enviou uma mensagem com possível risco à vida (chat ${chatId}). ` +
        (falhou ? 'ATENÇÃO: a transferência automática FALHOU. Abra a conversa agora.' : 'A conversa foi transferida para atendimento humano. Assuma imediatamente.'),
    )
  }

  async function onJoin(data) {
    const chat = data.chat
    if (chat?.entityType !== 'LINES') return
    const settings = store.getSettings()
    if (settings.lineId && lineIdOf(chat) !== String(settings.lineId)) return

    const chatId = String(chat.id)
    const previous = store.getChat(chatId)
    const crisisRecent = previous.mode === 'crisis' && now() - new Date(previous.crisisAt) < CRISIS_LOCK_DAYS * DAY_MS

    if (crisisRecent) {
      // Cliente que passou pelo protocolo de crise recentemente vai direto para um humano.
      await safe('transferir', () => vibe.handToOperator(chatId))
      log({ chat: chatId, transferido: true, motivo: 'historico_crise', urgente: true })
      await notifyAlerts(settings, `🚨 Cliente que acionou o protocolo de crise nos últimos ${CRISIS_LOCK_DAYS} dias voltou a escrever no Canal Aberto (chat ${chatId}). Conversa enviada direto para atendimento humano.`)
      return
    }
    store.setChat(chatId, { mode: 'bot', history: [] })
  }

  async function onMessage(data) {
    const { message, chat, bot } = data
    if (!message || !chat) return
    if (message.isSystem || String(message.authorId) === String(bot?.id)) return
    if (chat.entityType !== 'LINES') return

    const settings = store.getSettings()
    if (settings.lineId && lineIdOf(chat) !== String(settings.lineId)) return
    if (!store.markSeen(`m:${message.id}`)) return

    const chatId = String(chat.id)
    const dialogId = chat.dialogId || `chat${chatId}`
    const text = String(message.text || '').trim()
    const state = store.getChat(chatId)

    if (state.mode === 'human' || state.mode === 'crisis') return

    // Mesmo com o bot desligado, a crise nunca passa sem o aviso do CVV e o alerta urgente.
    if (isCrisis(text)) return crisis({ chatId, dialogId, settings })

    if (!settings.enabled) {
      return handOff({ chatId, dialogId, settings, motivo: 'bot_desligado' })
    }
    if (!text) {
      return handOff({ chatId, dialogId, settings, motivo: 'midia', message: settings.handoffMessage })
    }
    if (isHumanRequest(text)) {
      return handOff({ chatId, dialogId, settings, motivo: 'pedido_cliente', message: settings.handoffMessage })
    }

    const history = [...state.history, { role: 'user', content: redactPII(text) }].slice(-HISTORY_LIMIT)

    let result
    try {
      result = await ai.decide({
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        systemPrompt: settings.systemPrompt,
        history,
      })
    } catch (err) {
      logger.error(`[openai] ${err.status || ''} ${err.message}`)
      return handOff({
        chatId,
        dialogId,
        settings,
        motivo: 'falha_openai',
        message: settings.fallbackMessage,
        entry: { modelo: settings.model, erro: String(err.status || err.name || 'erro') },
      })
    }

    const { decision, usage } = result
    const entry = { modelo: settings.model, tokens: usage }

    if (decision.motivo === 'crise') return crisis({ chatId, dialogId, settings, entry })
    if (decision.acao === 'transferir') {
      return handOff({ chatId, dialogId, settings, motivo: decision.motivo, message: decision.resposta || settings.handoffMessage, entry })
    }

    const keyboard = [{ TEXT: settings.operatorButton, ACTION: 'SEND', ACTION_VALUE: '/operador', DISPLAY: 'LINE' }]
    const sent = await safe('mensagem', () => vibe.sendMessage(dialogId, decision.resposta, keyboard))
    if (sent?.error) {
      return handOff({ chatId, dialogId, settings, motivo: 'falha_envio', entry })
    }
    store.setChat(chatId, {
      mode: 'bot',
      history: [...history, { role: 'assistant', content: decision.resposta }].slice(-HISTORY_LIMIT),
    })
    log({ chat: chatId, ...entry, transferido: false, motivo: 'nenhum' })
  }

  return {
    async handleEvent(event) {
      if (event?.type === 'ONIMBOTV2MESSAGEADD') return onMessage(event.data || {})
      if (event?.type === 'ONIMBOTV2JOINCHAT') return onJoin(event.data || {})
    },
  }
}
