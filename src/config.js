// Configuração fixa do processo (vem de variáveis de ambiente / segredos do servidor).
// Tudo que o dono da clínica pode mudar sem programar fica em settings (store.js).

export const env = {
  // Link do webhook de entrada do Bitrix24 (Desenvolvedores → Outros → Webhook de entrada),
  // com permissões imbot, imopenlines e im. Ex.: https://empresa.bitrix24.com.br/rest/1/abc123/
  bitrixWebhookUrl: process.env.BITRIX_WEBHOOK_URL || '',
  // Token que identifica o bot (inventado por nós, até 40 caracteres) e o ID devolvido no registro.
  botToken: process.env.BOT_TOKEN || '',
  botId: Number(process.env.BOT_ID) || null,
  // Segredo que vai no endereço registrado no Bitrix; avisos sem ele são recusados.
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  // Endereço público do servidor (usado só no registro do bot). Ex.: https://bot.exemplo.com
  publicUrl: process.env.PUBLIC_URL || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  dataDir: process.env.DATA_DIR || './data',
  port: Number(process.env.PORT) || 3000,
  preview: process.env.PREVIEW === '1',
}

export const HISTORY_LIMIT = 10
export const CRISIS_LOCK_DAYS = 30

export const DEFAULT_SYSTEM_PROMPT = `Você é o assistente virtual da Desenvolvendo Personalidade, clínica
multidisciplinar em Santo André/SP (psicologia, neuropsicologia,
nutrição, avaliações psicológicas e programas corporativos), com
atendimento presencial e online. Responda em português, de forma
cordial, breve e clara. Informe no início que é um assistente virtual.
Você trata apenas de assuntos administrativos: serviços, formatos de
atendimento e encaminhamento para agendamento. Nunca dê orientação
psicológica, diagnóstico ou opinião clínica. Se não souber algo, diga
que vai chamar alguém da equipe. Nunca invente preços, horários ou
informações.`

// Mensagem do protocolo de crise. Fica no código de propósito: é um texto de segurança
// revisado, não deve ser alterado sem querer pela tela de configuração.
export const CRISIS_MESSAGE = `Sinto muito que você esteja passando por isso. Você não está sozinho(a) e merece ajuda agora.

Se estiver em risco imediato, ligue para o CVV – Centro de Valorização da Vida: 188 (24 horas, gratuito), ou acesse cvv.org.br. Em emergência, ligue 192 (SAMU) ou 190.

Já estou chamando uma pessoa da nossa equipe para falar com você imediatamente.`

export const DEFAULT_SETTINGS = {
  enabled: true,
  model: 'gpt-5-mini',
  reasoningEffort: 'minimal',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  lineId: process.env.DEFAULT_LINE_ID || '',
  alertUserIds: process.env.DEFAULT_ALERT_USER_IDS || '',
  crisisTransferUserId: '',
  handoffMessage: 'Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Só um momento, por favor.',
  fallbackMessage: 'Desculpe, tive uma instabilidade agora. Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento.',
  operatorButton: 'Falar com um atendente',
}
