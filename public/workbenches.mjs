const workbenches = {
  product: {
    name: '产品经理工作台',
    document: '需求简报',
    objective: '这份简报要解决什么问题？',
    example: '说明使用场景、用户遇到的问题和需要验证的结果。',
    generate: '生成需求简报'
  },
  creator: {
    name: '自媒体工作台',
    document: '文章',
    objective: '这篇文章想讲什么？',
    example: '写清选题、核心观点和希望读者了解的内容。',
    generate: '起草文章'
  }
}

function element(tag, className, content) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function button(label, variant, onClick, {type = 'button', disabled = false} = {}) {
  const node = element('button', 'workbench-button workbench-button--' + variant, label)
  node.type = type
  node.disabled = disabled
  if (onClick) node.addEventListener('click', onClick)
  return node
}

function control(name, title, options) {
  const {value = '', placeholder = '', limit, rows, choices, required = false, change} = options
  const wrapper = element('label', 'workbench-field')
  wrapper.append(element('span', 'workbench-field__label', title))
  const input = document.createElement(choices ? 'select' : rows ? 'textarea' : 'input')
  input.name = name
  input.className = 'workbench-field__control'
  if (!choices) {
    input.placeholder = placeholder
    input.maxLength = limit
  }
  if (rows) input.rows = rows
  if (choices) {
    for (const [choice, label] of choices) {
      const option = document.createElement('option')
      option.value = choice
      option.textContent = label
      input.append(option)
    }
  }
  input.value = value
  input.required = required
  if (change) input.addEventListener(choices ? 'change' : 'input', () => change(name, input.value))
  wrapper.append(input)
  return wrapper
}

export function renderWorkbench(root, {
  kind, fieldState, confirmedBriefs, configured, busy, actions
}) {
  const {name, document: documentName, objective, example, generate} = workbenches[kind]
  const panel = element('aside', 'workbench-panel')
  panel.setAttribute('aria-label', name)
  panel.setAttribute('aria-busy', String(busy))

  const header = element('header', 'workbench-panel__header')
  header.append(
    element('h2', 'workbench-panel__title', name),
    button('收起', 'quiet', actions.close)
  )

  const form = element('form', 'workbench-panel__form')
  const fieldset = element('fieldset', 'workbench-panel__fields')
  fieldset.disabled = busy
  const change = actions.change
  fieldset.append(control('message', objective, {
    value: fieldState.message, placeholder: example, limit: 4000, rows: 4, required: true, change
  }))

  if (kind === 'creator') {
    fieldset.append(
      control('audience', '读者', {
        value: fieldState.audience, placeholder: '例如，第一次接触这项产品的人', limit: 200, change
      }),
      control('tone', '表达方式', {
        value: fieldState.tone, placeholder: '例如，口语化，给出具体例子', limit: 200, change
      }),
      control('briefId', '引用已定稿的简报', {
        value: fieldState.briefId,
        choices: [['', '不引用简报'], ...confirmedBriefs.map(brief => [brief.id, brief.title])],
        change
      })
    )
  }

  const sources = element('section', 'workbench-panel__sources')
  sources.append(
    element('h3', 'workbench-panel__subtitle', '参考资料'),
    control('sourceTitle', '资料名称', {
      value: fieldState.sourceTitle, placeholder: '例如，访谈记录或文章标题', limit: 160, change
    }),
    control('sourceText', '资料正文', {
      value: fieldState.sourceText, placeholder: '可粘贴需要引用的内容', limit: 12000, rows: 4, change
    })
  )
  fieldset.append(sources)

  const footer = element('footer', 'workbench-panel__footer')
  const status = element('p', 'workbench-panel__status',
    busy ? '正在生成草稿…' : configured ? '生成的草稿会加入当前会话。' : 'AI 尚未配置，可手动撰写草稿。'
  )
  status.setAttribute('role', 'status')
  footer.append(
    status,
    button(busy ? '正在生成…' : generate, 'primary', null, {type: 'submit', disabled: busy || !configured}),
    button('手动撰写' + documentName, 'secondary', actions.manual, {disabled: busy})
  )

  form.addEventListener('submit', event => {
    event.preventDefault()
    if (configured && !busy) actions.generate()
  })
  form.append(fieldset, footer)
  panel.append(header, form)
  root.replaceChildren(panel)
  return panel
}

function editor(draft, actions, close) {
  const form = element('form', 'draft-card__editor')
  const heading = control('title', '标题', {value: draft.title, limit: 160, required: true})
  const content = control('body', '正文', {value: draft.body, limit: 16000, rows: 10, required: true})
  const buttons = element('div', 'draft-card__controls')
  buttons.append(
    button('保存修改', 'primary', null, {type: 'submit'}),
    button('取消编辑', 'quiet', close)
  )
  form.addEventListener('submit', event => {
    event.preventDefault()
    const data = new FormData(form)
    const title = data.get('title').trim()
    const body = data.get('body').trim()
    const invalid = title ? (body ? null : content) : heading
    if (invalid) {
      const input = invalid.querySelector('.workbench-field__control')
      input.value = ''
      input.reportValidity()
      return
    }
    close()
    actions.save({title, body})
  })
  form.append(heading, content, buttons)
  return form
}

function revisionForm(actions, close) {
  const form = element('form', 'draft-card__revision')
  const field = control('feedback', '修改意见', {
    placeholder: '例如，缩短开头，保留案例和结论。', limit: 4000, rows: 3, required: true
  })
  const buttons = element('div', 'draft-card__controls')
  buttons.append(
    button('按意见修改', 'primary', null, {type: 'submit'}),
    button('取消', 'quiet', close)
  )
  form.addEventListener('submit', event => {
    event.preventDefault()
    const feedback = new FormData(form).get('feedback').trim()
    if (!feedback) {
      const input = field.querySelector('textarea')
      input.value = ''
      input.reportValidity()
      return
    }
    close()
    actions.revise(feedback)
  })
  form.append(field, buttons)
  return form
}

function referenceList(references) {
  const details = element('details', 'draft-card__references')
  const summary = element('summary', '', '参考资料（' + references.length + '）')
  const list = element('ol', 'draft-card__reference-list')
  for (const reference of references) {
    const item = element('li', 'draft-card__reference')
    item.append(
      element('h4', 'draft-card__reference-title', reference.title),
      element('p', 'draft-card__reference-body', reference.text)
    )
    list.append(item)
  }
  details.append(summary, list)
  return details
}

export function renderDraft(draft, {configured, busy, actions}) {
  const {document: documentName} = workbenches[draft.kind]
  const final = draft.status === 'final'
  const complete = Boolean(draft.title.trim() && draft.body.trim())
  const card = element('article', 'draft-card')
  card.dataset.draftId = draft.id
  card.setAttribute('aria-label', draft.title)
  card.setAttribute('aria-busy', String(busy))

  const header = element('header', 'draft-card__header')
  header.append(
    element('span', 'draft-card__category', documentName),
    element('span', final ? 'draft-card__status draft-card__status--final' : 'draft-card__status',
      busy ? '正在处理' : final ? '已定稿' : '草稿')
  )
  const main = element('div', 'draft-card__main')
  const preview = element('div', 'draft-card__preview')
  preview.append(
    element('h3', 'draft-card__title', draft.title),
    element('p', 'draft-card__body', draft.body || '点击编辑，填写草稿正文。')
  )
  if (draft.references?.length) preview.append(referenceList(draft.references))
  if (draft.feedback) preview.append(element('p', 'draft-card__feedback', '修改意见 · ' + draft.feedback))

  const controls = element('div', 'draft-card__controls')
  const activeForm = element('div', 'draft-card__active-form')
  let opener
  function closeForm() {
    activeForm.replaceChildren()
    preview.hidden = false
    controls.hidden = false
    opener?.focus()
  }
  function openForm(event, form, hidePreview) {
    opener = event.currentTarget
    controls.hidden = true
    preview.hidden = hidePreview
    activeForm.replaceChildren(form)
    form.elements[0].focus()
  }

  if (final) {
    controls.append(button('重新编辑', 'secondary', actions.reopen, {disabled: busy}))
  } else {
    controls.append(
      button('确认定稿', 'primary', actions.confirm, {disabled: busy || !complete}),
      button('编辑', 'secondary', event => openForm(event, editor(draft, actions, closeForm), true), {disabled: busy}),
      button('请 AI 修改', 'quiet', event => openForm(event, revisionForm(actions, closeForm), false), {
        disabled: busy || !configured || !complete
      })
    )
  }
  controls.append(
    button('复制', 'quiet', actions.copy, {disabled: busy || !complete}),
    button('下载', 'quiet', actions.download, {disabled: busy || !complete})
  )
  main.append(preview, activeForm, controls)
  card.append(header, main)
  return card
}
