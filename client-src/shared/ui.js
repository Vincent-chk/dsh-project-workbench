import React from 'react'
import { workbenchError } from '../workbench-content.js'

const h = React.createElement
const { useEffect } = React

export function Disclosure({ label, children, open, id }) {
  return h('details', { id, className: 'pw-disclosure', ...(open === undefined ? {} : { open }) },
    h('summary', null, label), children)
}

export function ReadText({ label, value, preview }) {
  if (!String(value ?? '').trim()) return null
  return h('div', null, label && h('strong', null, label),
    h('p', { className: preview ? 'pw-text pw-preview' : 'pw-text' }, value))
}

export function ErrorDetails({ error, t, showRaw = true }) {
  if (!error) return null
  const { text, raw } = workbenchError(typeof error === 'string' ? { message: error } : error, t)
  return h('div', { className: 'pw-error', role: 'alert' },
    h('div', null, text),
    showRaw && raw && h(Disclosure, { label: t('rawDetails') }, h(ReadText, { value: raw })))
}

export function Modal({ title, children, onClose, actions, wide }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h(React.Fragment, null,
    h('div', { className: 'pw-modal-mask', onClick: onClose }),
    h('div', { className: 'pw-modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': true, 'aria-label': title, 'data-window-drag-exclude': true },
      h('h3', null, title),
      wide ? h('div', { className: 'pw-modal-body' }, children) : children,
      h('div', { className: 'pw-modal-actions' }, actions)))
}

export function LeaveModal({ modal, t, busy, onStay, onSave, onDiscard }) {
  return h(Modal, { title: t('leaveTitle'), onClose: () => { if (!busy) onStay() }, actions: [
    h('button', { className: 'pw-button', onClick: onStay, disabled: busy }, t('keepEditing')),
    h('button', { className: 'pw-button danger', onClick: onDiscard, disabled: busy }, t('discardDraft')),
    h('button', { className: 'pw-button primary', onClick: onSave, disabled: busy }, t('saveAndLeave')),
  ] }, h('p', null, t('leaveBody')), modal.error && h('p', { className: 'pw-error' }, modal.error))
}
