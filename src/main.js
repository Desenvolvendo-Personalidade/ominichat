// Processo principal: tela de configuração + recepção dos avisos do Bitrix24 (webhook).

import { env } from './config.js'
import { createStore } from './store.js'
import { createBitrixClient } from './bitrix.js'
import { createOpenAIClient } from './openai.js'
import { createBot } from './bot.js'
import { createWebServer } from './web.js'

// Modo de visualização local: só a tela de configuração, sem receber mensagens.
function startPreview() {
  const store = createStore(env.dataDir)
  const bitrix = { listOpenlines: async () => [{ id: 25, name: '0800 - Plantão de Atendimento (exemplo)' }] }
  const ai = createOpenAIClient({ apiKey: env.openaiApiKey, baseUrl: env.openaiBaseUrl })
  createWebServer({ store, vibe: bitrix, status: () => ({ preview: true }), listModels: ai.listModels }).listen(env.port, () => {
    console.log(`Visualização local da tela de configuração: http://localhost:${env.port}`)
  })
}

function startBot() {
  if (!env.openaiApiKey) {
    console.warn('OPENAI_API_KEY ainda não definida: toda mensagem será transferida para um atendente.')
  }

  const store = createStore(env.dataDir)
  const bitrix = createBitrixClient({ webhookUrl: env.bitrixWebhookUrl, botId: env.botId, botToken: env.botToken })
  const ai = createOpenAIClient({ apiKey: env.openaiApiKey, baseUrl: env.openaiBaseUrl })
  const bot = createBot({ store, vibe: bitrix, ai })

  const health = { lastEventAt: null, openaiKey: Boolean(env.openaiApiKey) }
  const onEvent = event => {
    health.lastEventAt = new Date().toISOString()
    // Registro técnico, sem texto nem telefone do cliente (o entityId completo contém o número).
    const { chat, message } = event.data || {}
    const linha = String(chat?.entityId || '').split('|')[1] || '?'
    console.log(`[aviso] ${event.type} chat=${chat?.id} tipo=${chat?.entityType} linha=${linha} msg=${message?.id}`)
    return bot.handleEvent(event)
  }

  createWebServer({ store, vibe: bitrix, status: () => ({ ...health }), onEvent, webhookSecret: env.webhookSecret, listModels: ai.listModels }).listen(env.port, () => {
    console.log(`Bot no ar na porta ${env.port}. Avisos do Bitrix em /bitrix/eventos`)
  })
}

const missing = ['BITRIX_WEBHOOK_URL', 'BOT_TOKEN', 'BOT_ID', 'WEBHOOK_SECRET'].filter(
  k => !{ BITRIX_WEBHOOK_URL: env.bitrixWebhookUrl, BOT_TOKEN: env.botToken, BOT_ID: env.botId, WEBHOOK_SECRET: env.webhookSecret }[k],
)

// Sem as credenciais do bot (ex.: no computador local) abre só a visualização.
if (env.preview || missing.length) {
  if (!env.preview) console.warn(`Faltam ${missing.join(', ')}: iniciando só a visualização da tela, sem receber mensagens.`)
  startPreview()
} else {
  startBot()
}
