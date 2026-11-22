import {renderDraft, renderWorkbench} from './workbenches.mjs'
import {
  addDraft, addMessage, confirmedBriefs, draftMarkdown, newConversation, readState, storeState, workbenches
} from './state.mjs'

const get = id => document.getElementById(id)
const app = get('app')
const rail = get('rail')
const sessionList = get('session-list')
const workbenchPanel = get('workbench')
const messages = get('messages')
const composer = get('composer')
const messageInput = get('message-input')
const notice = get('notice')
const mobileMenu = get('mobile-menu')
const pluginButtons = {product: get('product-plugin'), creator: get('creator-plugin')}
const state = readState()
const pending = new Set()
let configured = null
let connectionError = ''
let activePlugin = null
let menuOpen = false

function activeConversation() {
  return state.conversations.find(conversation => conversation.id === state.activeId)
}

function element(tag, name, text) {
  const node = document.createElement(tag)
  if (name) node.className = name
  if (text !== undefined) node.textContent = text
  return node
}

function showNotice(message = '') {
  notice.textContent = message
  notice.hidden = !message
}

function closeMenu() {
  menuOpen = false
  app.classList.remove('app--menu-open')
  mobileMenu.setAttribute('aria-expanded', 'false')
}

function setPlugin(kind) {
  activePlugin = activePlugin === kind ? null : kind
  closeMenu()
  renderPanel()
  if (activePlugin) workbenchPanel.querySelector('input, textarea')?.focus()
}

function renderNavigation() {
  sessionList.replaceChildren(...state.conversations.map(conversation => {
    const active = conversation.id === state.activeId
    const item = element('button', active ? 'session-item session-item--active' : 'session-item', conversation.title)
    item.type = 'button'
    item.title = conversation.title
    if (active) item.setAttribute('aria-current', 'true')
    item.addEventListener('click', () => {
      state.activeId = conversation.id
      closeMenu()
      showNotice()
      storeState(state)
      render({bottom: true})
    })
    return item
  }))
}

function renderWelcome() {
  const welcome = element('section', 'welcome')
  const title = element('h1', '', '今天想推进哪件事？')
  const detail = element('p', '', '在这里记录思路，或打开工作台整理需求和写作。')
  const actions = element('div', 'welcome-actions')
  for (const [kind, label] of [['product', '整理一份需求简报'], ['creator', '写一篇内容稿件']]) {
    const button = element('button', '', label)
    button.type = 'button'
    button.addEventListener('click', () => setPlugin(kind))
    actions.append(button)
  }
  welcome.append(title, detail, actions)
  return welcome
}

function renderMessage(entry) {
  const message = element('article', `message message--${entry.role}`)
  const label = {user: '你', assistant: '工作台助理', error: '请求提示'}[entry.role]
  message.append(element('span', 'message-label', label), element('div', 'message-text', entry.text))
  return message
}

function updateDraft(conversation, draft, patch) {
  Object.assign(draft, patch)
  storeState(state)
  if (conversation.id === state.activeId) render()
}

function clipboardError(error) {
  showNotice(error.message || '复制未完成，请选中文字后复制。')
}

function downloadDraft(draft) {
  const file = new Blob([draftMarkdown(draft)], {type: 'text/markdown;charset=utf-8'})
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  const baseName = draft.title.trim().replace(/[\\/:"*?<>|]+/g, '_').slice(0, 64)
  link.href = url
  link.download = `${baseName || '文稿'}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function renderMessages(conversation, bottom) {
  const currentTop = messages.scrollTop
  if (conversation.entries.length === 0 && !pending.has(conversation.id)) {
    messages.replaceChildren(renderWelcome())
    return
  }
  messages.replaceChildren(...conversation.entries.map(entry => {
    if (entry.type === 'message') return renderMessage(entry)
    return renderDraft(entry, {
      configured: configured === true,
      busy: pending.has(conversation.id),
      actions: {
        save: patch => updateDraft(conversation, entry, patch),
        confirm: () => updateDraft(conversation, entry, {status: 'final'}),
        reopen: () => updateDraft(conversation, entry, {status: 'draft'}),
        revise: feedback => reviseDraft(conversation, entry, feedback),
        copy: () => navigator.clipboard.writeText(draftMarkdown(entry)).then(
          () => showNotice('已复制文稿。'), clipboardError
        ),
        download: () => downloadDraft(entry)
      }
    })
  }))
  if (pending.has(conversation.id)) {
    messages.append(renderMessage({role: 'assistant', text: '正在处理这条请求…'}))
  }
  messages.scrollTop = bottom ? messages.scrollHeight : currentTop
}

function renderPanel() {
  const conversation = activeConversation()
  const open = activePlugin !== null
  workbenchPanel.hidden = !open
  app.classList.toggle('app--panel-open', open)
  for (const [kind, button] of Object.entries(pluginButtons)) {
    button.setAttribute('aria-expanded', String(kind === activePlugin))
    button.classList.toggle('plugin-button--active', kind === activePlugin)
  }
  if (!open) {
    workbenchPanel.replaceChildren()
    return
  }
  const kind = activePlugin
  const fields = conversation.fields[kind]
  renderWorkbench(workbenchPanel, {
    kind,
    fieldState: fields,
    confirmedBriefs: confirmedBriefs(state),
    configured: configured === true,
    busy: pending.has(conversation.id),
    actions: {
      close: () => setPlugin(kind),
      change: (field, value) => {
        fields[field] = value
        storeState(state)
      },
      generate: () => generateDraft(conversation, kind),
      manual: () => createManualDraft(conversation, kind)
    }
  })
}

function render({bottom = false} = {}) {
  const conversation = activeConversation()
  get('conversation-title').textContent = conversation.title
  if (messageInput.value !== conversation.composer) messageInput.value = conversation.composer
  const connectionStatus = get('connection-status')
  connectionStatus.textContent = configured === true ? '模型已配置'
    : connectionError ? '连接状态不可用' : configured === false ? '模型未配置' : '正在检查模型配置'
  connectionStatus.dataset.connected = String(configured === true)
  connectionStatus.title = connectionError
  get('send-message').disabled = pending.has(conversation.id) || !conversation.composer.trim()
  renderNavigation()
  renderMessages(conversation, bottom)
  renderPanel()
}

function requestContext(conversation, kind) {
  const fields = conversation.fields[kind]
  const context = []
  if (fields.sourceText.trim()) {
    context.push({title: fields.sourceTitle.trim() || '补充资料', text: fields.sourceText.trim()})
  }
  if (kind === 'creator') {
    const brief = confirmedBriefs(state).find(item => item.id === fields.briefId)
    if (brief) context.push({title: brief.title, text: brief.body})
  }
  return context
}

async function generate(conversation, payload, onSuccess) {
  pending.add(conversation.id)
  if (conversation.id === state.activeId) render({bottom: true})
  const finished = (body, error) => {
    pending.delete(conversation.id)
    if (!state.conversations.includes(conversation)) return
    if (error) addMessage(conversation, 'error', error.message)
    else onSuccess(body)
    storeState(state)
    if (conversation.id === state.activeId) render({bottom: true})
  }
  await fetch('/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  }).then(async response => {
    const body = await response.json()
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : body.error?.message
      throw new Error(message || '模型请求未完成。')
    }
    return body
  }).then(body => finished(body), error => finished(null, error))
}

function canGenerate(conversation) {
  if (pending.has(conversation.id)) return false
  if (configured === true) return true
  showNotice('模型尚未配置。连接模型后即可发送消息或生成草稿。')
  return false
}

function generateDraft(conversation, kind) {
  if (!canGenerate(conversation)) return
  const fields = conversation.fields[kind]
  const message = fields.message.trim()
  if (!message) {
    showNotice('请输入这次要完成的任务。')
    return
  }
  const context = requestContext(conversation, kind)
  activePlugin = null
  showNotice()
  addMessage(conversation, 'user', message)
  storeState(state)
  return generate(conversation, {
    mode: kind, message, context,
    options: {audience: fields.audience, tone: fields.tone}
  }, response => {
    if (response.message) addMessage(conversation, 'assistant', response.message)
    addDraft(conversation, kind, response.draft.title, response.draft.body, context)
  })
}

function createManualDraft(conversation, kind) {
  const plugin = workbenches[kind]
  const fields = conversation.fields[kind]
  const title = fields.message.trim().split('\n')[0].slice(0, 80) || plugin.draftTitle
  showNotice()
  closeMenu()
  activePlugin = null
  addDraft(conversation, kind, title, plugin.outline, requestContext(conversation, kind))
  storeState(state)
  render({bottom: true})
}

function reviseDraft(conversation, draft, feedback) {
  if (!canGenerate(conversation) || !feedback.trim()) return
  showNotice()
  return generate(conversation, {
    mode: 'revise',
    message: feedback.trim(),
    context: draft.references,
    draft: {title: draft.title, body: draft.body}
  }, response => {
    Object.assign(draft, response.draft, {status: 'draft', feedback: feedback.trim()})
  })
}

function submitMessage(event) {
  event.preventDefault()
  const conversation = activeConversation()
  const message = conversation.composer.trim()
  if (!message || !canGenerate(conversation)) return
  const history = conversationHistory(conversation)
  showNotice()
  addMessage(conversation, 'user', message)
  conversation.composer = ''
  storeState(state)
  return generate(conversation, {mode: 'chat', message, history}, response => {
    addMessage(conversation, 'assistant', response.message)
  })
}

function conversationHistory(conversation) {
  const history = []
  let remaining = 20_000
  const messages = conversation.entries.filter(entry => entry.type === 'message' && entry.role !== 'error').slice(-12)
  for (const entry of messages.reverse()) {
    if (entry.text.length > remaining) break
    history.unshift({role: entry.role, text: entry.text})
    remaining -= entry.text.length
  }
  return history
}

get('new-chat').addEventListener('click', () => {
  const conversation = newConversation()
  state.conversations.unshift(conversation)
  state.activeId = conversation.id
  activePlugin = null
  closeMenu()
  showNotice()
  storeState(state)
  render({bottom: true})
  messageInput.focus()
})
for (const [kind, button] of Object.entries(pluginButtons)) {
  button.addEventListener('click', () => setPlugin(kind))
}
get('rename-chat').addEventListener('click', () => {
  const conversation = activeConversation()
  const value = window.prompt('会话名称', conversation.title)
  const title = value?.trim().slice(0, 80)
  if (!title) return
  conversation.title = title
  storeState(state)
  render()
})
get('delete-chat').addEventListener('click', () => {
  const conversation = activeConversation()
  if (!window.confirm(`删除会话「${conversation.title}」及其中的文稿？`)) return
  state.conversations = state.conversations.filter(item => item !== conversation)
  if (state.conversations.length === 0) state.conversations.push(newConversation())
  state.activeId = state.conversations[0].id
  activePlugin = null
  showNotice()
  storeState(state)
  render({bottom: true})
})
mobileMenu.addEventListener('click', () => {
  menuOpen = !menuOpen
  app.classList.toggle('app--menu-open', menuOpen)
  mobileMenu.setAttribute('aria-expanded', String(menuOpen))
  if (menuOpen) rail.querySelector('button')?.focus()
})
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (menuOpen) {
    closeMenu()
    mobileMenu.focus()
  } else if (activePlugin) {
    const kind = activePlugin
    setPlugin(kind)
    pluginButtons[kind].focus()
  }
})
messageInput.addEventListener('input', () => {
  const conversation = activeConversation()
  conversation.composer = messageInput.value
  get('send-message').disabled = pending.has(conversation.id) || !conversation.composer.trim()
  storeState(state)
})
messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (!get('send-message').disabled) composer.requestSubmit()
  }
})
composer.addEventListener('submit', submitMessage)

render({bottom: true})
fetch('/api/status').then(async response => {
  if (!response.ok) throw new Error('无法读取模型配置。')
  const body = await response.json()
  configured = body.configured === true
  render()
}).catch(error => {
  connectionError = error.message
  render()
})
