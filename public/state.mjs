const storageKey = 'conversation-workbench.v1'

export const workbenches = Object.freeze({
  product: {title: '产品经理工作台', draftTitle: '需求简报', outline: '用户问题\n\n需求范围\n\n验收条件\n'},
  creator: {title: '自媒体工作台', draftTitle: '内容稿件', outline: '开头\n\n正文\n\n结尾\n'}
})

export function makeId() {
  return crypto.randomUUID()
}

function newFields() {
  return {message: '', sourceTitle: '', sourceText: '', audience: '', tone: '', briefId: ''}
}

export function newConversation() {
  return {
    id: makeId(),
    title: '新会话',
    entries: [],
    composer: '',
    fields: {product: newFields(), creator: newFields()}
  }
}

export function readState() {
  const serialized = localStorage.getItem(storageKey)
  if (serialized !== null) return JSON.parse(serialized)
  const conversation = newConversation()
  return {activeId: conversation.id, conversations: [conversation]}
}

export function storeState(state) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

export function addMessage(conversation, role, text) {
  const entry = {id: makeId(), type: 'message', role, text}
  conversation.entries.push(entry)
  if (role === 'user' && conversation.title === '新会话') {
    conversation.title = [...text.trim().replace(/\s+/g, ' ')].slice(0, 20).join('')
  }
  return entry
}

export function addDraft(conversation, kind, title, body, references) {
  const draft = {id: makeId(), type: 'draft', kind, title, body, status: 'draft', references}
  conversation.entries.push(draft)
  if (conversation.title === '新会话') conversation.title = title
  return draft
}

export function confirmedBriefs(state) {
  return state.conversations.flatMap(conversation =>
    conversation.entries.filter(entry => entry.type === 'draft' && entry.kind === 'product' && entry.status === 'final')
  )
}

export function draftMarkdown(draft) {
  return `# ${draft.title}\n\n${draft.body.trimEnd()}\n`
}
