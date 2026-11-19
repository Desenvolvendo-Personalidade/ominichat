// Tela de configuração, endpoint de saúde e recepção dos avisos do Bitrix24.
// Até existir login (etapa 4), a tela só abre quando acessada pelo próprio computador
// (endereço localhost). Por um túnel ou pela internet ela fica bloqueada.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFormBody, toBotEvent, validSecret } from './webhook.js'

const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'page.html'), 'utf8')

const EDITABLE = {
  model: v => /^[\w.\-:/]{2,80}$/.test(v),
  reasoningEffort: v => ['', 'none', 'minimal', 'low', 'medium', 'high'].includes(v),
  systemPrompt: v => v.trim().length >= 20 && v.length <= 20000,
  lineId: v => v === '' || /^\d+$/.test(v),
  alertUserIds: v => /^[\d,;\s]*$/.test(v),
  crisisTransferUserId: v => v === '' || /^\d+$/.test(v),
  handoffMessage: v => v.trim().length > 0 && v.length <= 1000,
  fallbackMessage: v => v.trim().length > 0 && v.length <= 1000,
  operatorButton: v => v.trim().length > 0 && v.length <= 50,
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readRaw(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 1_000_000) throw new Error('corpo grande demais')
  }
  return raw
}

async function readBody(req) {
  return JSON.parse((await readRaw(req)) || '{}')
}

// Tela acessada no próprio computador (http://localhost:PORTA).
function isLocalHost(req) {
  const host = String(req.headers.host || '').toLowerCase()
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
}

function summarize(entries) {
  const total = { mensagens: 0, tokens: 0, transferencias: 0, crises: 0, falhas: 0 }
  for (const e of entries) {
    if (!e.chat) continue
    total.mensagens++
    total.tokens += e.tokens?.total || 0
    if (e.transferido) total.transferencias++
    if (e.motivo === 'crise') total.crises++
    if (e.erro) total.falhas++
  }
  return total
}

const MODELS_TTL = 60 * 60 * 1000

// vibe: cliente da API do Bitrix (bitrix.js). onEvent: processa um aviso do Bitrix.
// listModels: busca os modelos do provedor de IA (openai.js); guardados por 1 hora.
export function createWebServer({ store, vibe, status, onEvent, webhookSecret, listModels, logger = console }) {
  let linesCache = null
  let modelsCache = null

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local')

      if (url.pathname === '/health') return send(res, 200, { ok: true, ...status() })

      // Aviso do Bitrix: responde OK na hora e processa em seguida.
      if (req.method === 'POST' && url.pathname === '/bitrix/eventos') {
        if (!onEvent || !validSecret(url.searchParams.get('s'), webhookSecret)) return send(res, 403, { erro: 'não autorizado' })
        const event = toBotEvent(parseFormBody(await readRaw(req)))
        send(res, 200, { ok: true })
        try {
          await onEvent(event)
        } catch (err) {
          logger.error(`[evento ${event.type}]`, err.message)
        }
        return
      }

      if (!isLocalHost(req)) {
        return send(res, 403, '<p style="font-family:sans-serif">Tela de configuração disponível só no computador do servidor, até o login ser criado.</p>', 'text/html; charset=utf-8')
      }

      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8')

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const all = store.readLog(Infinity)
        if (!linesCache) {
          linesCache = await vibe.listOpenlines().catch(() => null)
        }
        return send(res, 200, {
          settings: store.getSettings(),
          resumo: summarize(all),
          log: all.slice(0, 200),
          linhas: (linesCache || []).map(l => ({ id: String(l.id), nome: l.lineName || l.name || `Linha ${l.id}` })),
          status: status(),
        })
      }

      if (req.method === 'GET' && url.pathname === '/api/modelos') {
        if (!listModels) return send(res, 200, { modelos: [], erro: 'Lista de modelos indisponível.' })
        const refresh = url.searchParams.get('atualizar') === '1'
        if (refresh || !modelsCache || Date.now() - modelsCache.em > MODELS_TTL) {
          try {
            modelsCache = { em: Date.now(), modelos: await listModels() }
          } catch (err) {
            logger.error('[modelos]', err.message)
            if (!modelsCache) return send(res, 200, { modelos: [], erro: 'Não foi possível buscar a lista de modelos agora.' })
          }
        }
        return send(res, 200, { modelos: modelsCache.modelos, atualizadoEm: new Date(modelsCache.em).toISOString() })
      }

      if (req.method === 'POST' && (req.headers['content-type'] || '').startsWith('application/json')) {
        const body = await readBody(req)
        const who = 'acesso local'

        if (url.pathname === '/api/enabled') {
          const settings = store.updateSettings({ enabled: Boolean(body.enabled) })
          store.appendLog({ data: new Date().toISOString(), evento: settings.enabled ? 'bot_ligado' : 'bot_desligado', por: who })
          return send(res, 200, { settings })
        }

        if (url.pathname === '/api/settings') {
          const patch = {}
          for (const [key, valid] of Object.entries(EDITABLE)) {
            if (body[key] === undefined) continue
            const value = String(body[key])
            if (!valid(value)) return send(res, 400, { erro: `Valor inválido em "${key}"` })
            patch[key] = value
          }
          const settings = store.updateSettings(patch)
          store.appendLog({ data: new Date().toISOString(), evento: 'configuracao_alterada', campos: Object.keys(patch), por: who })
          return send(res, 200, { settings })
        }
      }

      send(res, 404, { erro: 'não encontrado' })
    } catch (err) {
      console.error('[web]', err.message)
      send(res, 500, { erro: 'erro interno' })
    }
  })
}
