import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCrisis, isHumanRequest, redactPII } from '../src/detect.js'

test('reconhece frases de risco à vida (com e sem acento)', () => {
  for (const t of [
    'Estou pensando em suicídio',
    'tenho vontade de morrer',
    'Não quero mais viver',
    'eu quero me matar',
    'Ontem eu me cortei de novo',
    'vou acabar com a minha vida',
    'meu marido me bate todo dia',
    'estou sendo agredida em casa',
    'NAO QUERO VIVER',
  ]) assert.equal(isCrisis(t), true, t)
})

test('não dispara crise em mensagens comuns', () => {
  for (const t of [
    'Quero agendar uma avaliação neuropsicológica',
    'Vocês atendem online?',
    'Qual o valor da consulta de nutrição?',
    'Morro de vontade de começar a terapia',
    'Matar a saudade da clínica',
  ]) assert.equal(isCrisis(t), false, t)
})

test('reconhece pedido de atendente humano', () => {
  for (const t of ['Quero falar com um atendente', 'posso falar com uma pessoa?', '/operador', 'preciso de um atendente', 'atendimento com humano'])
    assert.equal(isHumanRequest(t), true, t)
  assert.equal(isHumanRequest('Quais são os serviços?'), false)
})

test('remove e-mail, CPF e telefone antes de enviar para a IA', () => {
  const out = redactPII('ana@ex.com, cpf 123.456.789-09, tel (11) 98765-4321')
  assert.doesNotMatch(out, /ana@|123\.456|98765/)
})
