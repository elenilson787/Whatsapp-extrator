import { mkdir, writeFile } from 'node:fs/promises'
import type { GroupMetadata } from '@whiskeysockets/baileys'
import type { BatchRunResult } from './batch-run.js'

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function writeBatchRunReport(
  source: GroupMetadata,
  destination: GroupMetadata,
  result: BatchRunResult,
): Promise<{ jsonPath: string; csvPath: string }> {
  await mkdir('reports', { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const basePath = `reports/batch-run-${stamp}`
  const jsonPath = `${basePath}.json`
  const csvPath = `${basePath}.csv`

  const report = {
    generatedAt: new Date().toISOString(),
    source: { id: source.id, subject: source.subject },
    destination: {
      id: destination.id,
      subject: destination.subject,
      memberAddMode: destination.memberAddMode,
    },
    ...result,
  }

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const rows = [
    [
      'index',
      'status',
      'apiStatus',
      'confirmed',
      'requestJid',
      'id',
      'phoneNumber',
      'lid',
      'attemptedAt',
      'error',
    ],
    ...result.results.map((item, index) => [
      index + 1,
      item.status,
      item.apiStatus,
      item.confirmed,
      item.requestJid,
      item.target.id,
      item.target.phoneNumber ?? '',
      item.target.lid ?? '',
      item.attemptedAt,
      item.error ?? '',
    ]),
  ]

  await writeFile(
    csvPath,
    `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
    'utf8',
  )

  return { jsonPath, csvPath }
}
