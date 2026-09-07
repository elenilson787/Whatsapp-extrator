import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import type { ParticipantRecord } from './groups.js'
import type { IdentityLike } from './identity.js'
import { identityJids, sameIdentity } from './identity.js'
import { executeSingleAdd } from './real-run.js'
import type { RealRunResult } from './real-run.js'

export type BatchRunResult = {
  startedAt: string
  completedAt: string
  maxUsers: number
  requested: number
  attempted: number
  stoppedEarly: boolean
  stopReason?: string
  results: RealRunResult[]
}

export function parseBatchMaxUsers(raw?: string): number {
  const parsed = Number((raw ?? '').trim())
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 5) {
    throw new Error('No teste em lote, MAX_USERS deve ser um inteiro entre 2 e 5.')
  }
  return parsed
}

export function parseTargetPhones(raw?: string): string[] {
  if (!raw?.trim()) {
    throw new Error('TARGET_PHONES é obrigatório no teste em lote.')
  }

  const phones = raw
    .split(/[;,\n]/)
    .map((value) => value.trim().replace(/\D/g, ''))
    .filter(Boolean)

  const unique = [...new Set(phones)]
  if (unique.length !== phones.length) {
    throw new Error('TARGET_PHONES contém números duplicados.')
  }

  return unique
}

export function selectPinnedCandidates(
  candidates: ParticipantRecord[],
  targets: IdentityLike[],
  maxUsers: number,
): ParticipantRecord[] {
  if (targets.length === 0) {
    throw new Error('Nenhum alvo foi informado para o teste em lote.')
  }

  if (targets.length > maxUsers) {
    throw new Error(`Foram informados ${targets.length} alvos, acima de MAX_USERS=${maxUsers}.`)
  }

  const selected: ParticipantRecord[] = []

  for (const target of targets) {
    if (identityJids(target).length === 0) {
      throw new Error('Um dos alvos do lote não possui identidade válida.')
    }

    const matches = candidates.filter((candidate) => sameIdentity(candidate, target))
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? 'Um dos TARGET_PHONES não corresponde a candidato válido atual. Execute novo DRY RUN.'
          : 'Um dos TARGET_PHONES corresponde a mais de um candidato. Lote abortado.',
      )
    }

    if (selected.some((candidate) => sameIdentity(candidate, matches[0]))) {
      throw new Error('Dois TARGET_PHONES resolveram para o mesmo participante. Lote abortado.')
    }

    selected.push(matches[0])
  }

  return selected
}

function shouldStop(status: RealRunResult['status']): boolean {
  return [
    'permission_denied',
    'forbidden',
    'rejected',
    'not_confirmed',
    'error',
  ].includes(status)
}

export function parseBatchDelayMs(raw?: string): number {
  const parsed = Number(raw ?? '15000')
  if (!Number.isFinite(parsed)) return 15000
  // Intervalo fixo para limitar carga e manter a execução controlada.
  // Não há aleatorização nem lógica destinada a contornar controles do WhatsApp.
  return Math.min(120000, Math.max(10000, Math.floor(parsed)))
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function executeControlledBatch(
  sock: Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>,
  destinationJid: string,
  candidates: ParticipantRecord[],
  options: {
    maxUsers: number
    delayMs?: number
    fetchDestination?: () => Promise<GroupMetadata>
    onResult?: (result: RealRunResult) => Promise<void> | void
    waitFn?: (ms: number) => Promise<void>
  },
): Promise<BatchRunResult> {
  if (candidates.length > options.maxUsers) {
    throw new Error('Quantidade de candidatos excede o limite rígido do lote.')
  }

  const startedAt = new Date().toISOString()
  const results: RealRunResult[] = []
  const delayMs = parseBatchDelayMs(String(options.delayMs ?? 15000))
  const waitFn = options.waitFn ?? wait
  let stopReason: string | undefined

  for (const [index, candidate] of candidates.entries()) {
    const result = await executeSingleAdd(sock, destinationJid, candidate, {
      fetchDestination: options.fetchDestination,
    })
    results.push(result)
    await options.onResult?.(result)

    if (shouldStop(result.status)) {
      stopReason = `Lote interrompido após ${result.status} (API ${result.apiStatus}).`
      break
    }

    if (index < candidates.length - 1) {
      await waitFn(delayMs)
    }
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    maxUsers: options.maxUsers,
    requested: candidates.length,
    attempted: results.length,
    stoppedEarly: results.length < candidates.length,
    stopReason,
    results,
  }
}
