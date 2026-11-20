import React from 'react'

const h = React.createElement
const { useEffect, useLayoutEffect, useRef, useState } = React

export const readingDrawerLocale = {
  en: { readingMaterials: 'Materials and records', closeReading: 'Close reading panel', backToReading: 'Back to reading panel' },
  zh: { readingMaterials: '资料与记录', closeReading: '关闭资料抽屉', backToReading: '返回资料抽屉' },
}

export function ReadingLink({ label, summary, onClick, id, expanded }) {
  return h('button', {
    type: 'button', className: 'pw-reading-link', id, onClick, 'aria-expanded': expanded,
  }, h('span', null, label),
  summary && h('span', { className: 'pw-reading-link-meta', title: summary }, summary),
  h('span', { 'aria-hidden': true, className: 'pw-reading-chevron' }, '›'))
}

function focusReader(node, scroll = true) {
  if (!node) return
  if (node.tagName === 'DETAILS') node.open = true
  const control = node.tagName === 'DETAILS' ? node.querySelector('summary') : node
  control?.focus({ preventScroll: true })
  if (scroll) control?.scrollIntoView({ block: 'nearest' })
}

export function ReadingLayout({ t, rail, drawer, onClose, scrollMemory, scrollKey, modalActive, children }) {
  const frame = useRef(null)
  const main = useRef(null)
  const index = useRef(null)
  const reader = useRef(null)
  const body = useRef(null)
  const bodyContent = useRef(null)
  const stopRestore = useRef(null)
  const closeButton = useRef(null)
  const previous = useRef(null)
  const [width, setWidth] = useState(() => document.documentElement.clientWidth)
  const [indexOpen, setIndexOpen] = useState(false)
  const narrow = width <= 710
  const overlay = !!drawer && width < 890
  const drawerKey = drawer && (drawer.key ?? drawer.title)
  const drawerScrollKey = drawerKey && scrollKey && scrollKey + ':drawer:' + (drawer.scrollKey ?? drawerKey)

  useLayoutEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (main.current) main.current.inert = overlay
  }, [overlay])
  useLayoutEffect(() => {
    if (main.current) main.current.scrollTop = scrollMemory?.[scrollKey] ?? 0
  }, [scrollKey, scrollMemory])
  useLayoutEffect(() => {
    if (drawer) {
      previous.current = drawer.trigger ?? previous.current
      closeButton.current?.focus({ preventScroll: true })
    } else if (previous.current) {
      const previousTrigger = previous.current
      previous.current = null
      // A dialog opened by the same action owns focus when it closes the drawer.
      if (modalActive) return
      const trigger = typeof previousTrigger === 'string'
        ? document.getElementById(previousTrigger) : previousTrigger
      const narrowIndex = narrow && index.current?.querySelector('summary')
      const fallback = narrowIndex || main.current
      ;(trigger?.isConnected && trigger.getClientRects().length ? trigger : fallback)?.focus({ preventScroll: true })
    }
  }, [drawerKey])
  useLayoutEffect(() => {
    const element = body.current
    if (!element) return
    const saved = scrollMemory?.[drawerScrollKey] ?? 0
    element.scrollTop = saved
    if (element.scrollTop >= saved || !bodyContent.current) return
    // A returned PRD can still be loading. Restore after enough of it renders.
    const observer = new ResizeObserver(() => {
      element.scrollTop = saved
      if (element.scrollTop >= saved) stopRestore.current?.()
    })
    const stop = () => {
      observer.disconnect()
      stopRestore.current = null
    }
    stopRestore.current = stop
    observer.observe(bodyContent.current)
    return stop
  }, [drawerScrollKey, scrollMemory])
  useEffect(() => {
    if (!drawer?.focusId) return
    const target = () => reader.current?.querySelectorAll('[id]')
    const apply = () => {
      const match = Array.from(target() ?? []).find(node => node.id === drawer.focusId)
      if (!match) return false
      focusReader(match, drawer.focusId !== 'pw-prd-open-full')
      return true
    }
    if (apply() || !body.current) return
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect() })
    observer.observe(body.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [drawerKey, drawer?.focusId])
  useEffect(() => {
    if (!overlay || reader.current?.contains(document.activeElement)) return
    closeButton.current?.focus({ preventScroll: true })
  }, [overlay])

  const onKeyDown = event => {
    if (event.defaultPrevented || !drawer || modalActive || event.nativeEvent?.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab' && overlay) {
      const controls = Array.from(reader.current.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'))
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && event.target === first || !event.shiftKey && event.target === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
  }
  return h('div', {
    className: 'pw-reading-frame' + (rail ? ' has-index' : '') + (drawer ? ' has-drawer' : '') + (overlay ? ' is-overlay' : '') + (narrow ? ' is-narrow' : ''),
    ref: frame, onKeyDown,
  },
  rail && h('details', {
    className: 'pw-reading-index', ref: index, open: !narrow || indexOpen, hidden: !!drawer,
    onToggle: event => { if (narrow && event.target === event.currentTarget) setIndexOpen(event.currentTarget.open) },
  },
  h('summary', null, t('readingMaterials')),
  h('div', { className: 'pw-reading-index-items', 'aria-label': t('readingMaterials') }, rail)),
  h('div', {
    className: 'pw-reading-main', ref: main, tabIndex: -1,
    onScroll: event => { if (scrollMemory && scrollKey) scrollMemory[scrollKey] = event.currentTarget.scrollTop },
  }, children),
  overlay && h('div', { className: 'pw-reading-shade', 'aria-hidden': true, onClick: onClose }),
  drawer && h('aside', {
    className: 'pw-reading-drawer', ref: reader, role: overlay ? 'dialog' : 'complementary',
    'aria-modal': overlay || undefined, 'aria-label': drawer.title,
  },
  h('header', { className: 'pw-reading-drawer-head' }, h('h2', null, drawer.title),
    h('button', {
      type: 'button', className: 'pw-button pw-quiet', ref: closeButton, onClick: onClose,
      'aria-label': t('closeReading'),
    }, '×')),
  h('div', {
    className: 'pw-reading-drawer-body', ref: body, key: drawerKey,
    onPointerDown: () => stopRestore.current?.(),
    onWheel: () => stopRestore.current?.(),
    onKeyDown: event => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) stopRestore.current?.()
    },
    onScroll: event => {
      if (!stopRestore.current && scrollMemory && drawerScrollKey) scrollMemory[drawerScrollKey] = event.currentTarget.scrollTop
    },
  }, h('div', { ref: bodyContent }, drawer.body))))
}

export const readingDrawerCss = `
.pw-reading-frame{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:12px;position:relative;flex:1;min-height:0;min-width:0;isolation:isolate;container-type:inline-size}
.pw-reading-frame.has-index:not(.is-narrow):not(.has-drawer){grid-template-columns:minmax(0,1fr) clamp(182px,24%,270px)}
.pw-reading-frame.has-drawer:not(.is-overlay){grid-template-columns:minmax(0,1fr) clamp(318px,36%,465px)}
.pw-reading-main{min-width:0;min-height:0;overflow:auto;grid-column:1;grid-row:1}
.pw-reading-main:focus:not(:focus-visible){outline:none}
.pw-reading-main>.pw-subpage{overflow:visible}
.pw-reading-index{grid-column:2;grid-row:1;min-width:0;min-height:0;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;padding:10px}
.pw-reading-index[hidden],.pw-reading-index>summary{display:none}
.pw-reading-index-items{display:flex;flex-direction:column}
.pw-reading-link{width:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px;align-items:center;min-height:44px;border:0;border-block-end:1px solid var(--dsw-alias-border-l3);padding:8px;text-align:start;color:var(--dsw-alias-label-primary);font:inherit;background:none;cursor:pointer;border-radius:4px;overflow-wrap:anywhere}
.pw-reading-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-reading-link:focus-visible,.pw-reading-index>summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-reading-link-meta{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:10ch;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
.pw-reading-chevron{grid-column:3;color:var(--dsw-alias-label-secondary)}
.pw-reading-frame.is-narrow.has-index:not(.has-drawer){grid-template-rows:auto minmax(0,1fr);gap:8px}
.pw-reading-frame.is-narrow .pw-reading-index{grid-column:1;grid-row:1;padding:4px 10px;max-height:36dvh}
.pw-reading-frame.is-narrow .pw-reading-index>summary{display:list-item;cursor:pointer;padding:6px 0;min-height:34px;color:var(--dsw-alias-label-primary)}
.pw-reading-frame.is-narrow.has-index:not(.has-drawer) .pw-reading-main{grid-row:2}
.pw-reading-drawer{grid-column:2;grid-row:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:10px}
.pw-reading-drawer-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 13px;border-block-end:1px solid var(--dsw-alias-border-l3)}
.pw-reading-drawer-head h2{font-size:15px;line-height:1.4;margin:0}
.pw-reading-drawer-head button{min-width:34px;font-size:18px}
.pw-reading-drawer-body{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:13px;overflow-wrap:anywhere}
.pw-reading-drawer-body>div>.pw-update-list{max-height:none;overflow:visible;gap:0}
.pw-reading-drawer-body>div>.pw-update-list>.pw-update{background:none;border:0;border-block-end:1px solid var(--dsw-alias-border-l3);border-radius:0;padding:8px 3px;align-items:baseline}
.pw-reading-drawer-body .pw-prd-reader-inline .pw-prd-scroll{max-height:none;overflow:visible;border:0}
.pw-reading-drawer-body .pw-prd-reader-inline .pw-prd-article{padding:4px 0}
.pw-reading-shade{position:absolute;z-index:1;inset:0;border-radius:10px;background:rgb(0 0 0 / 35%)}
.pw-reading-frame.is-overlay .pw-reading-drawer{position:absolute;grid-area:auto;z-index:2;inset-block:0;inset-inline-end:0;width:min(100%,455px);box-sizing:border-box}
@container (max-width:530px){.pw-reading-frame.is-overlay .pw-reading-drawer{width:100%}}
`
