// Registra o bot no Bitrix24 (uma vez só) ou atualiza o endereço dele.
// Uso: npm run registrar
//   - sem BOT_ID: registra o bot e mostra o BOT_ID para colocar no .env
//   - com BOT_ID: atualiza o endereço de avisos (ex.: depois de mudar de servidor)

import { env } from '../src/config.js'
import { createBitrixClient } from '../src/bitrix.js'

const missing = ['BITRIX_WEBHOOK_URL', 'BOT_TOKEN', 'WEBHOOK_SECRET', 'PUBLIC_URL'].filter(
  k => !{ BITRIX_WEBHOOK_URL: env.bitrixWebhookUrl, BOT_TOKEN: env.botToken, WEBHOOK_SECRET: env.webhookSecret, PUBLIC_URL: env.publicUrl }[k],
)
if (missing.length) {
  console.error(`Faltam no .env: ${missing.join(', ')}`)
  process.exit(1)
}
if (!env.publicUrl.startsWith('https://')) {
  console.error('PUBLIC_URL precisa começar com https:// (o Bitrix não chama endereços locais).')
  process.exit(1)
}

const bitrix = createBitrixClient({ webhookUrl: env.bitrixWebhookUrl, botId: env.botId, botToken: env.botToken })
const webhookUrl = `${env.publicUrl.replace(/\/$/, '')}/bitrix/eventos?s=${encodeURIComponent(env.webhookSecret)}`

try {
  if (env.botId) {
    await bitrix.call('imbot.v2.Bot.update', {
      botId: env.botId,
      botToken: env.botToken,
      fields: { eventMode: 'webhook', webhookUrl },
    })
    console.log(`Endereço do bot ${env.botId} atualizado para ${env.publicUrl}/bitrix/eventos`)
  } else {
    const result = await bitrix.call('imbot.v2.Bot.register', {
      fields: {
        code: 'ominichat_assistente',
        botToken: env.botToken,
        type: 'openline',
        isSupportOpenline: true,
        eventMode: 'webhook',
        webhookUrl,
        properties: { name: 'Ominichat IA' },
      },
    })
    console.log(`Bot registrado. Coloque no .env:  BOT_ID=${result?.bot?.id}`)
    console.log('Depois: Canais Abertos → Configurar → Chatbots, e escolha "Ominichat IA" no canal desejado.')
  }
} catch (err) {
  console.error(`Falhou: ${err.code || ''} ${err.message}`)
  process.exit(1)
}
