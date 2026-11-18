export async function rpc(method, input) {
  try {
    const res = await fetch('/api/project-workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, input }),
    })
    const body = await res.json()
    return body?.ok === false && typeof body === 'object' ? { ...body, method } : body
  } catch (error) {
    return { ok: false, code: 'TRANSPORT_ERROR', message: error instanceof Error ? error.message : String(error), method }
  }
}
