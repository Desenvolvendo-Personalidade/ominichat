// Detecção por palavras-chave. Funciona mesmo se a OpenAI estiver fora do ar.
// É uma rede de segurança: prefere errar para o lado de chamar um humano.

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

const CRISIS_PATTERNS = [
  /\bsuicid/,
  /\bme matar\b/,
  /\bmatar a mim\b/,
  /\bquero morrer\b/,
  /\bvontade de morrer\b/,
  /\bpensando em morrer\b/,
  /\bpenso em morrer\b/,
  /\bdesejo de morrer\b/,
  /\bprefiro morrer\b/,
  /\bqueria (estar )?morrer\b/,
  /\bqueria (estar )?mort[oa]\b/,
  /\bnao quero (mais )?viver\b/,
  /\bsem vontade de viver\b/,
  /\bacabar com (a minha|minha) vida\b/,
  /\btirar (a minha|minha) (propria )?vida\b/,
  /\bdar fim (a|na) (minha )?vida\b/,
  /\bsumir (de vez|para sempre|pra sempre)\b/,
  /\bme (cortar|cortei|corto|machucar|machuquei|machuco|ferir|feri)\b/,
  /\bautolesao\b/,
  /\bautomutila/,
  /\b(vou|quero) (me )?(jogar|pular) d[aeo]/,
  /\boverdose\b/,
  /\btomar (todos|todas) (os|as) (remedios|comprimidos)\b/,
  /\b(ele|ela|meu marido|minha esposa|meu namorado|minha namorada|meu pai|minha mae|meu companheiro|minha companheira) (me )?(bate|bateu|agride|agrediu|espanca|espancou|ameaca|ameacou)\b/,
  /\b(estou|to|tou) sendo (agredid|ameacad|espancad|abusad)/,
  /\bviolencia domestica\b/,
  /\bvou matar\b/,
  /\bquero matar\b/,
  /\bvontade de matar\b/,
]

const HUMAN_REQUEST_PATTERNS = [
  /^\/operador\b/,
  /^\/operator\b/,
  /\b(falar|conversar|atendimento) com (um |uma |o |a )?(humano|humana|pessoa|atendente|alguem|funcionari|secretari|recepcao|recepcionista)/,
  /\b(quero|preciso( de)?|gostaria de) (um |uma |o |a )?(atendente|humano|pessoa real)\b/,
  /\batendente humano\b/,
  /\bpessoa de verdade\b/,
]

export function isCrisis(text) {
  const t = normalize(text)
  return CRISIS_PATTERNS.some(re => re.test(t))
}

export function isHumanRequest(text) {
  const t = normalize(text).trim()
  return HUMAN_REQUEST_PATTERNS.some(re => re.test(t))
}

// Remove dados pessoais óbvios antes de mandar o texto para a IA.
export function redactPII(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
}
