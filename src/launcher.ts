const interactiveGroupSelection = process.argv.includes('--select-groups')
const autoBatch = !interactiveGroupSelection && process.env.AUTO_BATCH === 'true'

if (autoBatch) {
  const staleTargets = ['TARGET_PHONE', 'TARGET_PARTICIPANT', 'TARGET_PHONES'].filter(
    (name) => Boolean(process.env[name]?.trim()),
  )

  if (staleTargets.length > 0) {
    console.log(
      `[AUTO_BATCH] Ignorando alvo(s) antigo(s) da sessão: ${staleTargets.join(', ')}. A fila será selecionada automaticamente.`,
    )

    for (const name of staleTargets) {
      delete process.env[name]
    }
  }
}

await import('./index.js')
