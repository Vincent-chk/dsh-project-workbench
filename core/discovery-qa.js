const markdownPrefix = String.raw`[ \t]*(?:#{1,6}[ \t]+)?(?:[-+*][ \t]+)?`
const decoration = '(?:\\*\\*|__|`)?'
const delimiter = String.raw`(?:[ \t]*[:：.．、)）—-][ \t]*|[ \t]+|$)`
const answerDelimiter = String.raw`(?:[ \t]*[:：.．、)）—-][ \t]*|[ \t]*$)`
const answerLabel = String.raw`(?:[QA][ \t]*\d+|第[ \t]*\d+[ \t]*题)`
const questionMarker = new RegExp('^' + markdownPrefix + '❓?\\uFE0F?[ \\t]*' + decoration + 'Q\\d+' + decoration + delimiter, 'iu')
const answerMarker = new RegExp('^' + markdownPrefix + decoration + answerLabel + decoration + answerDelimiter, 'iu')
const inlineAnswer = new RegExp('(?<=[；;])[ \\t]*(?=' + decoration + answerLabel + decoration + answerDelimiter + ')', 'iu')

function discussionBlocks(text, marker, isAnswer) {
  const sections = []
  let current
  let fence
  for (const line of text.split(/\r?\n/)) {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})/)
    const canReadMarker = !fence && !boundary
    if (boundary && !fence) fence = boundary[1]
    else if (boundary && boundary[1].startsWith(fence)) fence = null
    if (!isAnswer && canReadMarker && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      current = null
      continue
    }
    const parts = isAnswer && canReadMarker ? line.split(inlineAnswer) : [line]
    for (const part of parts) {
      const match = canReadMarker ? part.match(marker) : null
      if (match || (isAnswer && !current)) {
        current = { number: match ? Number(match[0].match(/\d+/)[0]) : null, lines: [] }
        sections.push(current)
      }
      if (!current) continue
      const body = match ? part.slice(match[0].length) : part
      const recommendation = !isAnswer && canReadMarker ? body.search(/(?:^|[ \t])➡️?/u) : -1
      current.lines.push(recommendation === -1 ? body : body.slice(0, recommendation))
      if (recommendation !== -1) current = null
    }
  }
  return sections.map(({ number, lines }) => ({ number, text: lines.join('\n').trim() }))
    .filter(block => block.number === null || (Number.isSafeInteger(block.number) && block.number > 0))
}

export function discoveryQuestions(messages) {
  const questions = []
  let round = 0
  let questionTurn
  let precedingQuestions = []
  for (const { seq, turn, role, text, closing } of messages) {
    if (role === 'assistant') {
      precedingQuestions = []
      const blocks = closing ? [] : discussionBlocks(text, questionMarker, false).filter(block => block.text)
      if (!blocks.length) continue
      if (round === 0 || turn !== questionTurn) {
        round++
        questionTurn = turn
      }
      precedingQuestions = blocks.map(({ number, text: question }, position) => ({
        id: seq + ':' + position, number, round, question, answered: false,
      }))
      questions.push(...precedingQuestions)
      continue
    }
    const adjacent = precedingQuestions.filter(question => !question.answered)
    precedingQuestions = []
    if (!questions.length || /^(?:\/\S+|@workbench\b)/iu.test(text)) continue
    const blocks = discussionBlocks(text, answerMarker, true)
    const numbered = blocks.filter(block => block.number !== null)
    if (numbered.length) {
      for (const { number, text: answer } of numbered) {
        if (!answer) continue
        const matches = questions.filter(question => question.number === number)
        const recent = matches.filter(question => question.round === round)
        const candidates = recent.length ? recent : matches
        if (candidates.length === 1) candidates[0].answered = true
      }
    } else if (adjacent.length === 1 && blocks.length === 1 && blocks[0].text) {
      adjacent[0].answered = true
    }
  }
  return questions
}

const choiceLine = /^[ \t]*(?:[-*+][ \t]+)?((?:[a-z]|\d+)[.)．、）:：]|\((?:[a-z]|\d+)\)|（(?:[a-z]|\d+)）)(?:[ \t]+|(?=\p{Script=Han}))(\S.*)$/iu

export function discoveryQuestionText(question) {
  const original = { stem: question, choices: [] }
  if (/^ {0,3}(?:`{3,}|~{3,})/m.test(question)) return original
  const lines = question.split(/\r?\n/)
  const choices = []
  let first = -1
  for (const [index, line] of lines.entries()) {
    const match = line.replace(/(\*\*|__)([^\n]+?)\1/g, '$2').match(choiceLine)
    if (match) {
      if (first === -1) first = index
      const [, label, text] = match
      choices.push({ label, text })
    } else if (first !== -1 && line.trim()) {
      // An unlabelled paragraph after a list can be part of the question itself.
      if (!/^(?: {2,}|\t)\S/.test(line)) return original
      choices.at(-1).text += '\n' + line.trim()
    }
  }
  if (first < 1 || choices.length < 2) return original
  const labels = choices.map(choice => choice.label.replace(/[^a-z\d]/gi, '').toLowerCase())
  if (new Set(labels).size !== choices.length || labels.some(label => /^\d/u.test(label) !== /^\d/u.test(labels[0]))) return original
  const stem = lines.slice(0, first).join('\n').trim()
  return stem ? { stem, choices } : original
}
