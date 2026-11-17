// Cliente da API VibeCode (Bitrix24). A chave fica só no servidor.

export class ApiError extends Error {
  constructor(message, { status, code, retryAfter } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

export function createVibeClient({ apiKey, baseUrl, botId, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { 'X-Api-Key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) {
      throw new ApiError(json.error?.message || `HTTP ${res.status}`, {
        status: res.status,
        code: json.error?.code,
        retryAfter: Number(res.headers.get('retry-after')) || undefined,
      })
    }
    return json.data
  }

  return {
    call,
    pollEvents(offset) {
      const qs = offset != null ? `?offset=${encodeURIComponent(offset)}` : ''
      return call('GET', `/bots/${botId}/events${qs}`)
    },
    sendMessage(dialogId, message, keyboard) {
      return call('POST', `/bots/${botId}/messages`, {
        dialogId,
        fields: { message, ...(keyboard ? { keyboard } : {}) },
      })
    },
    // Transferência nativa do Canal Aberto para o próximo operador livre da fila.
    handToOperator(chatId) {
      return call('POST', `/bots/${botId}/openlines/session/operator`, { chatId })
    },
    // Transferência para um funcionário específico (usado na crise, se configurado).
    transferToUser(chatId, userId) {
      return call('POST', `/bots/${botId}/openlines/session/transfer`, { chatId, userId: String(userId), leave: true })
    },
    notifyUser(userId, message) {
      return call('POST', '/notifications', { userId: Number(userId), message })
    },
    listOpenlines() {
      return call('GET', '/openline-configs')
    },
  }
}
