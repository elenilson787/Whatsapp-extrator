import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BatchStatusSummary } from './batch-run.js'

export type OperatorLastPair = {
  sourceJid: string
  destinationJid: string
  sourceName: string
  destinationName: string
  updatedAt: string
}

export type OperatorState = {
  version: 1
  lastPair?: OperatorLastPair
}

export type OperatorHistoryEntry = {
  file: string
  generatedAt: string
  sourceName: string
  destinationName: string
  attempted: number
  requested: number
  summary: BatchStatusSummary
}

const DEFAULT_STATE_PATH = 'data/operator-state.json'

export function emptyOperatorState(): OperatorState {
  return { version: 1 }
}

export async function loadOperatorState(
  path = DEFAULT_STATE_PATH,
): Promise<OperatorState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as OperatorState
    if (parsed.version !== 1) {
      throw new Error('Estado do operador incompatível com esta versão.')
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return emptyOperatorState()
    }
    throw error
  }
}

export async function saveLastPair(
  pair: Omit<OperatorLastPair, 'updatedAt'>,
  path = DEFAULT_STATE_PATH,
): Promise<OperatorState> {
  const state: OperatorState = {
    version: 1,
    lastPair: {
      ...pair,
      updatedAt: new Date().toISOString(),
    },
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return state
}

function emptySummary(): BatchStatusSummary {
  return {
    added: 0,
    invite_required: 0,
    permission_denied: 0,
    forbidden: 0,
    rejected: 0,
    not_confirmed: 0,
    outcome_unknown: 0,
    error: 0,
  }
}

function normalizeSummary(report: {
  summary?: Partial<BatchStatusSummary>
  results?: Array<{ status?: string }>
}): BatchStatusSummary {
  const summary = emptySummary()

  if (report.summary) {
    for (const key of Object.keys(summary) as Array<keyof BatchStatusSummary>) {
      const value = report.summary[key]
      summary[key] = typeof value === 'number' ? value : 0
    }
    return summary
  }

  for (const result of report.results ?? []) {
    if (result.status && result.status in summary) {
      summary[result.status as keyof BatchStatusSummary] += 1
    }
  }

  return summary
}

export async function loadOperatorHistory(
  reportsDir = 'reports',
  limit = 10,
): Promise<OperatorHistoryEntry[]> {
  let names: string[]
  try {
    names = await readdir(reportsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw error
  }

  const files = names
    .filter((name) => /^batch-run-.*\.json$/i.test(name))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, Math.max(1, limit))

  const history: OperatorHistoryEntry[] = []

  for (const file of files) {
    try {
      const report = JSON.parse(await readFile(join(reportsDir, file), 'utf8')) as {
        generatedAt?: string
        source?: { subject?: string }
        destination?: { subject?: string }
        attempted?: number
        requested?: number
        summary?: Partial<BatchStatusSummary>
        results?: Array<{ status?: string }>
      }

      const summary = normalizeSummary(report)
      history.push({
        file,
        generatedAt: report.generatedAt ?? file,
        sourceName: report.source?.subject ?? '(origem desconhecida)',
        destinationName: report.destination?.subject ?? '(destino desconhecido)',
        attempted: report.attempted ?? report.results?.length ?? 0,
        requested: report.requested ?? report.results?.length ?? 0,
        summary,
      })
    } catch {
      // Um relatório corrompido não impede o operador de mostrar os demais.
    }
  }

  return history
}
