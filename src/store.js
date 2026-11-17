// Persistência simples em arquivos JSON dentro de DATA_DIR.
// settings.json: configurações editáveis | state.json: estado das conversas | log.jsonl: registro.

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from './config.js'

const MAX_SEEN = 2000

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const settingsFile = path.join(dataDir, 'settings.json')
  const stateFile = path.join(dataDir, 'state.json')
  const logFile = path.join(dataDir, 'log.jsonl')

  let settings = { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) }
  const state = readJson(stateFile, { offset: null, chats: {}, seen: [] })
  const seen = new Set(state.seen)

  function saveState() {
    state.seen = [...seen].slice(-MAX_SEEN)
    writeJsonAtomic(stateFile, state)
  }

  return {
    getSettings: () => ({ ...settings }),
    updateSettings(patch) {
      settings = { ...settings, ...patch }
      writeJsonAtomic(settingsFile, settings)
      return { ...settings }
    },

    getOffset: () => state.offset,
    setOffset(offset) {
      state.offset = offset
      saveState()
    },

    // Evita processar a mesma mensagem duas vezes (a plataforma não garante entrega única).
    markSeen(key) {
      if (seen.has(key)) return false
      seen.add(key)
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value)
      saveState()
      return true
    },

    getChat(chatId) {
      return state.chats[chatId] || { mode: 'bot', history: [] }
    },
    setChat(chatId, chat) {
      state.chats[chatId] = chat
      saveState()
    },

    appendLog(entry) {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
    },
    readLog(limit = 200) {
      let lines
      try {
        lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
      return lines.slice(-limit).map(l => JSON.parse(l)).reverse()
    },
  }
}
