/** POST /actions/<name> on the daemon (docs/architecture.md). Failures are logged, never thrown. */
export async function postAction(name: string, body: object = {}): Promise<void> {
  try {
    const res = await fetch(`/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.error(`action ${name}: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error(`action ${name}:`, err)
  }
}
