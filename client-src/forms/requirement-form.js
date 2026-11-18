import React from 'react'
import { Disclosure } from '../shared/ui.js'
import { EditableField } from './task-form.js'

const h = React.createElement

// 标题与需求概述必填（新建、编辑保存与送审共用）；目标和边界选填，补充信息默认收起。
export function requirementFormError(draft) {
  const fields = [!draft.title.trim() && 'title', !draft.q_pain.trim() && 'overview'].filter(Boolean)
  return fields.length ? { ok: false, code: 'REVIEW_INFO_REQUIRED', message: 'required: ' + fields.join(', ') } : null
}

export function RequirementFields({ form, t, busy, req, autoFocus }) {
  const oldCriteria = req?.q_success?.trim()
  const criteria = req?.acceptance?.trim()
  const criteriaField = oldCriteria && !criteria ? 'q_success' : 'acceptance'
  return h('div', { className: 'pw-requirement-fields' },
    h(EditableField, { form, name: 'title', label: t('issueTitle'), disabled: busy, required: true, autoFocus }),
    h(EditableField, { form, name: 'q_pain', label: t('requirementOverview'), rows: 1, disabled: busy, required: true }),
    h(EditableField, { form, name: 'goal', label: t('goal'), rows: 2, disabled: busy }),
    h(EditableField, { form, name: 'scope', label: t('requirementScope'), rows: 2, disabled: busy }),
    h(Disclosure, { label: t('requirementExtra') },
      h(EditableField, { form, name: 'q_who', label: t('q_who'), disabled: busy }),
      h(EditableField, { form, name: criteriaField, label: t('requirementCriteria'), rows: 2, disabled: busy }),
      oldCriteria && criteria && oldCriteria !== criteria &&
        h(EditableField, { form, name: 'q_success', label: t('q_success'), rows: 2, disabled: busy }),
      req?.q_out?.trim() && h(EditableField, { form, name: 'q_out', label: t('q_out'), rows: 2, disabled: busy })))
}
