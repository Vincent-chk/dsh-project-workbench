import React from 'react'

const h = React.createElement
const { useEffect, useRef, useState } = React

export const movableRequirementBlocks = ['prds', 'review', 'tasks', 'development', 'delivery']

const defaultOpen = {
  backlog: ['basic', 'prds'],
  reviewing: ['prds', 'review'],
  ready: ['basic', 'review'],
  in_progress: ['tasks', 'development'],
  pending: ['delivery', 'tasks'],
  completed: ['delivery'],
}

export function requirementBlockOrder(saved) {
  const allowed = new Set(movableRequirementBlocks)
  const ordered = Array.isArray(saved) ? saved.filter(id => allowed.delete(id)) : []
  return ['basic', ...ordered, ...allowed, 'log']
}

export const requirementLayoutLocale = {
  en: {
    reqBasic: 'Basic information', reqRelatedPrds: 'Linked PRDs', reqReviews: 'Review records',
    reqTasks: 'Tasks', reqDevelopment: 'Development records', reqDelivery: 'Delivery and acceptance',
    reqLog: 'Activity log', reqBlockOrder: 'Arrange sections', reqRestoreOrder: 'Restore default order', reqFinishOrder: 'Done',
    reqFixedBlock: 'Fixed', reqDragBlock: 'Drag {section}', reqMoveBlock: '{action} {section}',
    reqOrderSaveError: 'This order is available in this window. Local preferences could not be saved.',
    reqNoPrds: 'No linked PRDs', reqNoReviews: 'No review records', reqNoTasks: 'No tasks',
    reqNoDevelopment: 'No development records', reqNoDelivery: 'No delivery records',
    reqPrdCount: '{n} linked', reqReviewCount: '{n} records', reqTasksCount: '{n} tasks',
    reqLoadingPrds: 'Loading linked PRDs…', reqLoadingReviews: 'Loading review records…',
  },
  zh: {
    reqBasic: '基本信息', reqRelatedPrds: '关联 PRD', reqReviews: '评审记录',
    reqTasks: '下属任务', reqDevelopment: '开发记录', reqDelivery: '交付与验收',
    reqLog: '日志', reqBlockOrder: '调整板块顺序', reqRestoreOrder: '恢复默认顺序', reqFinishOrder: '完成',
    reqFixedBlock: '固定', reqDragBlock: '拖动「{section}」', reqMoveBlock: '{action}「{section}」',
    reqOrderSaveError: '本机偏好保存失败，本窗口内仍可使用当前顺序。',
    reqNoPrds: '尚无关联 PRD', reqNoReviews: '尚无评审记录', reqNoTasks: '尚无任务',
    reqNoDevelopment: '尚无开发记录', reqNoDelivery: '尚无交付记录',
    reqPrdCount: '{n} 份', reqReviewCount: '{n} 条', reqTasksCount: '{n} 项任务',
    reqLoadingPrds: '正在读取关联 PRD…', reqLoadingReviews: '正在读取评审记录…',
  },
}

export function RequirementLayout({ blocks, layoutKey, status, uiMemory, t, focus, arranging, onFinish }) {
  const readingMemory = uiMemory.requirementReading ??= {}
  const orderMemory = uiMemory.requirementOrders ??= {}
  const storageKey = 'project-workbench.requirement-order.' + layoutKey
  const [order, setOrder] = useState(() => {
    if (orderMemory[layoutKey]) return orderMemory[layoutKey]
    try {
      return requirementBlockOrder(JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? 'null'))
    } catch {
      return requirementBlockOrder()
    }
  })
  const [draft, setDraft] = useState(null)
  const [saveError, setSaveError] = useState(false)
  const [reading, setReading] = useState(() => readingMemory[layoutKey])
  const [dropHint, setDropHint] = useState(null)
  const dragged = useRef(null)
  const appliedFocus = useRef(null)
  const activeReading = reading?.status === status ? reading : { status, open: defaultOpen[status] ?? ['basic'] }
  const displayedOrder = draft ?? order

  // A new phase gets its own default even when the browser sends no toggle event.
  useEffect(() => {
    readingMemory[layoutKey] = activeReading
    if (reading !== activeReading) setReading(activeReading)
  }, [activeReading, reading, readingMemory, layoutKey])

  const rememberOpen = (id, isOpen) => {
    if (activeReading.open.includes(id) === isOpen) return
    setReading(current => {
      const open = current?.status === status ? current.open : activeReading.open
      return { status, open: isOpen ? [...new Set([...open, id])] : open.filter(block => block !== id) }
    })
  }

  useEffect(() => {
    if (!focus || arranging || focus === appliedFocus.current) return
    const block = document.getElementById('pw-requirement-block-' + focus.block)
    if (!block) return
    appliedFocus.current = focus
    block.open = true
    const target = (focus.elementId && document.getElementById(focus.elementId)) || block
    if (target.tagName === 'DETAILS') target.open = true
    const control = target.tagName === 'DETAILS' ? target.querySelector('summary') : target
    control?.focus({ preventScroll: true })
    control?.scrollIntoView({ block: 'nearest' })
  }, [focus, arranging])

  const clearDrag = () => { dragged.current = null; setDropHint(null) }
  const finish = save => {
    if (save && draft) {
      setOrder(draft)
      try {
        const storage = globalThis.localStorage
        if (!storage) throw new Error('Local preferences unavailable')
        const movable = draft.slice(1, -1)
        if (movable.every((id, index) => id === movableRequirementBlocks[index])) storage.removeItem(storageKey)
        else storage.setItem(storageKey, JSON.stringify(movable))
        delete orderMemory[layoutKey]
        setSaveError(false)
      } catch {
        orderMemory[layoutKey] = draft
        setSaveError(true)
      }
    }
    setDraft(null)
    clearDrag()
    onFinish()
  }

  const move = (id, index) => {
    if (!movableRequirementBlocks.includes(id) || index < 1 || index >= displayedOrder.length - 1) return
    const next = displayedOrder.filter(block => block !== id)
    next.splice(index, 0, id)
    setDraft(next)
  }

  const dropTarget = event => {
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-requirement-sort-row]')
    if (!row || !movableRequirementBlocks.includes(row.dataset.requirementSortRow)) return null
    const bounds = row.getBoundingClientRect()
    return { id: row.dataset.requirementSortRow, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' }
  }
  const finishDrag = event => {
    const source = dragged.current
    if (!source || event.button !== 0 || (event.pointerId != null && source.pointerId !== event.pointerId)) return
    const moved = Math.hypot(event.clientX - source.x, event.clientY - source.y) >= 6
    const target = source.active || moved ? dropTarget(event) : null
    if (target) {
      const sourceIndex = displayedOrder.indexOf(source.id)
      const insertion = displayedOrder.indexOf(target.id) + (target.position === 'after' ? 1 : 0)
      move(source.id, insertion - (sourceIndex < insertion ? 1 : 0))
    }
    clearDrag()
  }

  return h('div', { className: 'pw-requirement-layout', onPointerUpCapture: finishDrag, onMouseUpCapture: finishDrag, onKeyDown: event => {
    if (arranging && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  } },
  saveError && h('p', { className: 'pw-note', role: 'status' }, t('reqOrderSaveError')),
  arranging && h('div', { className: 'pw-actions pw-requirement-layout-actions' },
    h('button', { type: 'button', className: 'pw-button primary', onClick: () => finish(true) }, t('reqFinishOrder')),
    h('button', { type: 'button', className: 'pw-button', onClick: () => finish(false) }, t('cancel')),
    h('button', { type: 'button', className: 'pw-button pw-quiet', onClick: () => setDraft(requirementBlockOrder()) }, t('reqRestoreOrder'))),
  displayedOrder.map((id, index) => {
    const { label, summary, body } = blocks[id]
    const movable = movableRequirementBlocks.includes(id)
    const moveLabel = action => t('reqMoveBlock').replace('{action}', t(action)).replace('{section}', label)
    return h('div', { key: id },
      arranging && h('div', {
        className: 'pw-requirement-sort-row', 'data-drop': dropHint?.id === id ? dropHint.position : undefined,
        'data-requirement-sort-row': id,
      },
      movable && h('span', {
        className: 'pw-requirement-grip', title: t('reqDragBlock').replace('{section}', label),
        onPointerDown: event => {
          if (event.button !== 0) return
          dragged.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        },
        onPointerMove: event => {
          const source = dragged.current
          if (source?.pointerId !== event.pointerId) return
          if (!source.active && Math.hypot(event.clientX - source.x, event.clientY - source.y) < 6) return
          source.active = true
          const target = dropTarget(event)
          setDropHint(previous => previous?.id === target?.id && previous?.position === target?.position ? previous : target)
        },
        onPointerCancel: clearDrag, onLostPointerCapture: clearDrag,
      }, '⠿'),
      h('strong', null, label),
      movable ? h('div', { className: 'pw-actions' },
        h('button', { type: 'button', className: 'pw-orderbtn', disabled: index === 1, 'aria-label': moveLabel('moveUp'), onClick: () => move(id, index - 1) }, '↑'),
        h('button', { type: 'button', className: 'pw-orderbtn', disabled: index === displayedOrder.length - 2, 'aria-label': moveLabel('moveDown'), onClick: () => move(id, index + 1) }, '↓'))
        : h('span', { className: 'pw-note' }, t('reqFixedBlock'))),
      h('details', {
        id: 'pw-requirement-block-' + id, className: 'pw-disclosure pw-requirement-block',
        hidden: arranging, open: activeReading.open.includes(id),
        onToggle: event => { if (event.target === event.currentTarget) rememberOpen(id, event.currentTarget.open) },
      },
      h('summary', null, h('strong', null, label), summary && h('span', { className: 'pw-note pw-preview' }, summary)),
      h('div', { className: 'pw-requirement-block-body' }, body)))
  }))
}
