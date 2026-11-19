// Recebe os avisos do Bitrix24 (modo webhook do Chatbots 2.0) e converte para o formato
// de evento que o bot.js entende: { type, data }.

import { timingSafeEqual } from 'node:crypto'

// O Bitrix envia application/x-www-form-urlencoded com chaves no estilo PHP:
// data[message][text]=oi  ->  { data: { message: { text: 'oi' } } }
export function parseFormBody(raw) {
  const out = {}
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, '').split('[')
    if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue
    let node = out
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {}
      node = node[p]
    }
    node[parts[parts.length - 1]] = value
  }
  return out
}

// No modo webhook os booleanos chegam como texto ("1"/"0").
function toBool(v) {
  return v === true || v === '1' || v === 'Y' || v === 'true'
}

export function toBotEvent(body) {
  const data = body.data || {}
  if (data.message) data.message = { ...data.message, isSystem: toBool(data.message.isSystem) }
  return { type: body.event, data }
}

// O segredo vai no próprio endereço registrado no Bitrix (?s=...).
export function validSecret(received, expected) {
  if (!expected || typeof received !== 'string') return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
