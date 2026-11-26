/**
 * POST /actions/<name> on the daemon (docs/architecture.md). Never throws:
 * resolves to the error text on failure (also logged), or null on success.
 */
export async function postAction(name: string, body: object = {}): Promise<string | null> {
  try {
    const res = await fetch(`/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return null
    const text = await res.text()
    console.error(`action ${name}: ${res.status} ${text}`)
    try {
      const { error } = JSON.parse(text) as { error?: unknown }
      if (typeof error === 'string' && error) return error
    } catch {
      // not JSON: use the text as is
    }
    return text || `failed (${res.status})`
  } catch (err) {
    console.error(`action ${name}:`, err)
    return 'daemon unreachable'
  }
}
