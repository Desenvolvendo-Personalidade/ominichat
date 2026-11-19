// Cliente da API REST do Bitrix24 (Chatbots 2.0 / imbot.v2) via webhook de entrada.
// O link do webhook de entrada contém uma chave secreta: fica só no servidor.

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function createBitrixClient({ webhookUrl, botId, botToken, fetchImpl = fetch }) {
  const base = webhookUrl.endsWith('/') ? webhookUrl : `${webhookUrl}/`

  async function call(method, params = {}) {
    const res = await fetchImpl(`${base}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20_000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      throw new ApiError(json.error_description || json.error || `HTTP ${res.status}`, {
        status: res.status,
        code: json.error,
      })
    }
    return json.result
  }

  return {
    call,
    sendMessage(dialogId, message, keyboard) {
      return call('imbot.v2.Chat.Message.send', {
        botId,
        botToken,
        dialogId,
        fields: { message, ...(keyboard ? { keyboard } : {}) },
      })
    },
    // Devolve a conversa à fila do próprio Canal Aberto (próximo operador livre).
    handToOperator(chatId) {
      return call('imopenlines.bot.session.operator', { CHAT_ID: Number(chatId), CLIENT_ID: botToken })
    },
    // Transfere para um funcionário específico (usado na crise, se configurado).
    transferToUser(chatId, userId) {
      return call('imopenlines.bot.session.transfer', {
        CHAT_ID: Number(chatId),
        USER_ID: Number(userId),
        LEAVE: 'Y',
        CLIENT_ID: botToken,
      })
    },
    notifyUser(userId, message) {
      return call('im.notify.system.add', { USER_ID: Number(userId), MESSAGE: message })
    },
    async listOpenlines() {
      const lines = await call('imopenlines.config.list.get', { PARAMS: { select: ['ID', 'LINE_NAME'] } })
      return (lines || []).map(l => ({ id: l.ID, name: l.LINE_NAME }))
    },
  }
}
