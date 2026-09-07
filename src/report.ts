import { mkdir, writeFile } from 'node:fs/promises'
import type { GroupMetadata } from '@whiskeysockets/baileys'
import type { MigrationAnalysis, ParticipantRecord } from './groups.js'
import type { RealRunResult } from './real-run.js'

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function participantRows(
  status: string,
  participants: ParticipantRecord[],
): string[][] {
  return participants.map((participant) => [
    status,
    participant.id,
    participant.phoneNumber ?? '',
    participant.lid ?? '',
    participant.admin ?? '',
  ])
}

export async function writeDryRunReports(
  source: GroupMetadata,
  destination: GroupMetadata,
  analysis: MigrationAnalysis,
): Promise<{ jsonPath: string; csvPath: string }> {
  await mkdir('reports', { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const basePath = `reports/dry-run-${stamp}`
  const jsonPath = `${basePath}.json`
  const csvPath = `${basePath}.csv`

  const report = {
    generatedAt: new Date().toISOString(),
    source: { id: source.id, subject: source.subject },
    destination: { id: destination.id, subject: destination.subject },
    stats: {
      sourceTotal: analysis.sourceTotal,
      destinationTotal: analysis.destinationTotal,
      adminOrOwnerSkipped: analysis.adminOrOwnerSkipped.length,
      selfSkipped: analysis.selfSkipped.length,
      manuallyExcluded: analysis.manuallyExcluded.length,
      alreadyInDestination: analysis.alreadyInDestination.length,
      duplicateSourceSkipped: analysis.duplicateSourceSkipped.length,
      candidates: analysis.candidates.length,
    },
    candidates: analysis.candidates,
    skipped: {
      adminOrOwner: analysis.adminOrOwnerSkipped,
      self: analysis.selfSkipped,
      manuallyExcluded: analysis.manuallyExcluded,
      alreadyInDestination: analysis.alreadyInDestination,
      duplicateSource: analysis.duplicateSourceSkipped,
    },
  }

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const rows = [
    ['status', 'id', 'phoneNumber', 'lid', 'admin'],
    ...participantRows('candidate', analysis.candidates),
    ...participantRows('admin_or_owner', analysis.adminOrOwnerSkipped),
    ...participantRows('self', analysis.selfSkipped),
    ...participantRows('manual_exclusion', analysis.manuallyExcluded),
    ...participantRows('already_in_destination', analysis.alreadyInDestination),
    ...participantRows('duplicate_source', analysis.duplicateSourceSkipped),
  ]

  await writeFile(
    csvPath,
    `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
    'utf8',
  )

  return { jsonPath, csvPath }
}

export async function writeRealRunReport(
  source: GroupMetadata,
  destination: GroupMetadata,
  result: RealRunResult,
): Promise<{ jsonPath: string; csvPath: string }> {
  await mkdir('reports', { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const basePath = `reports/real-run-${stamp}`
  const jsonPath = `${basePath}.json`
  const csvPath = `${basePath}.csv`

  const report = {
    generatedAt: new Date().toISOString(),
    source: { id: source.id, subject: source.subject },
    destination: { id: destination.id, subject: destination.subject },
    maxUsers: 1,
    result,
  }

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const rows = [
    [
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
    [
      result.status,
      result.apiStatus,
      result.confirmed,
      result.requestJid,
      result.target.id,
      result.target.phoneNumber ?? '',
      result.target.lid ?? '',
      result.attemptedAt,
      result.error ?? '',
    ],
  ]

  await writeFile(
    csvPath,
    `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
    'utf8',
  )

  return { jsonPath, csvPath }
}
