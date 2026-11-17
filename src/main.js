// Processo principal: servidor da tela de configuração + laço que busca mensagens novas.

import { env } from './config.js'
import { createStore } from './store.js'
import { createVibeClient } from './vibe.js'
import { createOpenAIClient } from './openai.js'
import { createBot } from './bot.js'
import { createWebServer } from './web.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Modo de visualização local: só a tela de configuração, sem buscar mensagens.
// Rodar o laço de mensagens aqui disputaria os eventos com o bot em produção.
function startPreview() {
  const store = createStore(env.dataDir)
  const vibe = { listOpenlines: async () => [{ id: 25, name: '0800 - Plantão de Atendimento (exemplo)' }] }
  createWebServer({ store, vibe, status: () => ({ preview: true }), localAdmin: true }).listen(env.port, () => {
    console.log(`Visualização local da tela de configuração: http://localhost:${env.port}`)
  })
}

function startBot() {
  if (!env.openaiApiKey) {
    console.warn('OPENAI_API_KEY ainda não definida: toda mensagem será transferida para um atendente.')
  }

  const store = createStore(env.dataDir)
  const vibe = createVibeClient({ apiKey: env.vibeApiKey, baseUrl: env.vibeBaseUrl, botId: env.botId })
  const ai = createOpenAIClient({ apiKey: env.openaiApiKey, baseUrl: env.openaiBaseUrl })
  const bot = createBot({ store, vibe, ai })

  const health = { lastPollAt: null, lastPollError: null, openaiKey: Boolean(env.openaiApiKey) }

  createWebServer({ store, vibe, status: () => ({ ...health }) }).listen(env.port, () => {
    console.log(`Tela de configuração na porta ${env.port}`)
  })

  pollLoop({ store, vibe, bot, health })
}

async function pollLoop({ store, vibe, bot, health }) {
  let offset = store.getOffset()
  for (;;) {
    let wait = env.pollIntervalMs
    try {
      const data = await vibe.pollEvents(offset)
      for (const event of data.events || []) {
        try {
          await bot.handleEvent(event)
        } catch (err) {
          console.error(`[evento ${event.eventId}]`, err.message)
        }
      }
      if (data.nextOffset != null && data.nextOffset !== offset) {
        offset = data.nextOffset
        store.setOffset(offset)
      }
      if (data.hasMore) wait = 0
      health.lastPollAt = new Date().toISOString()
      health.lastPollError = null
    } catch (err) {
      health.lastPollError = `${err.code || err.status || ''} ${err.message}`.trim()
      console.error('[polling]', health.lastPollError)
      wait = err.retryAfter ? err.retryAfter * 1000 : Math.max(env.pollIntervalMs, 5000)
    }
    await sleep(wait)
  }
}

// Sem as credenciais do bot (ex.: no computador local) abre só a visualização.
if (env.preview || !env.vibeApiKey || !env.botId) {
  if (!env.preview) console.warn('BOT_VIBE_KEY/BOT_ID ausentes: iniciando só a visualização da tela, sem buscar mensagens.')
  startPreview()
} else {
  startBot()
}
