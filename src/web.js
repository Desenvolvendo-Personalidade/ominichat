// Tela de configuração (só administradores do Bitrix24) e endpoints de saúde.
// O acesso passa pelo Gateway da VibeCode, que injeta os cabeçalhos X-Vibe-*.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 100_000) throw new Error('corpo grande demais')
  }
  return JSON.parse(raw || '{}')
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

export function createWebServer({ store, vibe, status, localAdmin = false }) {
  let linesCache = null

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local')
      // Só na visualização local (npm run preview): age como administrador.
      if (localAdmin) {
        Object.assign(req.headers, { 'x-vibe-request-id': 'local', 'x-vibe-user-role': 'ADMIN', 'x-vibe-user-name': 'Visualização local' })
      }

      if (url.pathname === '/health') return send(res, 200, { ok: true, ...status() })

      // Requisição sem passar pelo Gateway (checagem interna do deploy): só o status.
      if (!req.headers['x-vibe-request-id']) {
        return send(res, 200, 'Bot de IA para Canais Abertos: em execução.', 'text/plain; charset=utf-8')
      }
      if (req.headers['x-vibe-user-role'] !== 'ADMIN') {
        return send(res, 403, '<p style="font-family:sans-serif">Acesso restrito a administradores do Bitrix24.</p>', 'text/html; charset=utf-8')
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

      if (req.method === 'POST' && (req.headers['content-type'] || '').startsWith('application/json')) {
        const body = await readBody(req)
        const who = `${req.headers['x-vibe-user-name'] || ''} (${req.headers['x-vibe-user-id'] || '?'})`

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
