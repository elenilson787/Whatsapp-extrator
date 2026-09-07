import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ParticipantRecord } from './groups.js'
import { identityJids } from './identity.js'
import type { RealRunResult } from './real-run.js'

export type AutoCheckpointEntry = {
  status: RealRunResult['status']
  apiStatus: string
  attemptedAt: string
  requestJid: string
}

export type AutoCheckpoint = {
  version: 1
  sourceJid: string
  destinationJid: string
  updatedAt: string
  processed: Record<string, AutoCheckpointEntry>
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function autoCheckpointPath(
  sourceJid: string,
  destinationJid: string,
  baseDir = 'data/checkpoints',
): string {
  return join(
    baseDir,
    `${safePart(sourceJid)}__${safePart(destinationJid)}.json`,
  )
}

export function createEmptyCheckpoint(
  sourceJid: string,
  destinationJid: string,
): AutoCheckpoint {
  return {
    version: 1,
    sourceJid,
    destinationJid,
    updatedAt: new Date().toISOString(),
    processed: {},
  }
}

export async function loadAutoCheckpoint(
  sourceJid: string,
  destinationJid: string,
  baseDir = 'data/checkpoints',
): Promise<AutoCheckpoint> {
  const path = autoCheckpointPath(sourceJid, destinationJid, baseDir)

  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as AutoCheckpoint
    if (
      parsed.version !== 1 ||
      parsed.sourceJid !== sourceJid ||
      parsed.destinationJid !== destinationJid ||
      !parsed.processed
    ) {
      throw new Error('Checkpoint incompatível com o par de grupos atual.')
    }
    return parsed
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return createEmptyCheckpoint(sourceJid, destinationJid)
    }
    throw error
  }
}

export async function saveAutoCheckpoint(
  checkpoint: AutoCheckpoint,
  baseDir = 'data/checkpoints',
): Promise<string> {
  const path = autoCheckpointPath(
    checkpoint.sourceJid,
    checkpoint.destinationJid,
    baseDir,
  )
  await mkdir(dirname(path), { recursive: true })
  checkpoint.updatedAt = new Date().toISOString()
  await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
  return path
}

export function wasProcessed(
  participant: ParticipantRecord,
  checkpoint: AutoCheckpoint,
): boolean {
  return identityJids(participant).some((jid) => Boolean(checkpoint.processed[jid]))
}

export function selectAutomaticCandidates(
  candidates: ParticipantRecord[],
  checkpoint: AutoCheckpoint,
  maxUsers: number,
): ParticipantRecord[] {
  if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 5) {
    throw new Error('AUTO_BATCH aceita no máximo 5 participantes por execução.')
  }

  // Nesta etapa do hardening, o modo automático usa somente participantes
  // cujo PN foi resolvido pela sessão. O caminho PN -> add -> confirmação já
  // foi validado em teste real; candidatos LID-only permanecem fora da fila.
  return candidates
    .filter((candidate) => Boolean(candidate.phoneNumber))
    .filter((candidate) => !wasProcessed(candidate, checkpoint))
    .slice(0, maxUsers)
}

export function recordCheckpointResult(
  checkpoint: AutoCheckpoint,
  result: RealRunResult,
): AutoCheckpoint {
  const entry: AutoCheckpointEntry = {
    status: result.status,
    apiStatus: result.apiStatus,
    attemptedAt: result.attemptedAt,
    requestJid: result.requestJid,
  }

  const aliases = new Set([
    ...identityJids(result.target),
    ...identityJids(result.requestJid),
  ])

  for (const alias of aliases) {
    checkpoint.processed[alias] = entry
  }

  checkpoint.updatedAt = new Date().toISOString()
  return checkpoint
}
