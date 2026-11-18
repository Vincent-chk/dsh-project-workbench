import { taskOverview } from '../../core/state.js'

export function taskRunView(status, run) {
  const pending = status?.pendingInteraction
  const waiting = !!pending
  const running = status?.running === true
  const locked = running || waiting || ['starting', 'uncertain', 'running'].includes(run?.state)
  const description = waiting ? (pending?.kind === 'approval' ? 'runWaiting' : 'runInteraction') : running ? 'runRunning'
    : run?.state === 'starting' ? 'runStarting' : run?.state === 'uncertain' ? 'runUncertain'
      : status?.running === false ? 'runIdle' : 'unknownRun'
  const action = waiting && pending?.kind === 'approval' ? 'goAuthorize' : 'viewConversation'
  const switchHint = waiting ? 'switchInteraction' : running ? 'switchRunning' : locked ? 'switchPending' : null
  return { running, waiting, locked, pending, description, action, switchHint }
}

export function taskChoices(requirements, { query = '', reqId = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase()
  return (requirements ?? []).flatMap(req => (req.issues ?? [])
    .filter(issue => (!reqId || req.id === reqId) && (!needle ||
      [issue.title, taskOverview(issue)].some(value => String(value ?? '').toLocaleLowerCase().includes(needle))))
    .map(issue => ({ ...issue, reqId: req.id, requirementTitle: req.title, requirementStatus: req.status })))
}

// Compare the first stamp with the hash from the detail read: a change may
// occur before that first tick. Later ticks also detect mtime/hash changes.
export function stampNeedsRead(previous, next) {
  if (!previous) return false
  if (previous.modified == null) return previous.hash != null && next.hash !== previous.hash
  return previous.modified !== next.modified || previous.hash !== next.hash
}

export const terminalTask = task => ['done', 'cancelled'].includes(task?.status)
