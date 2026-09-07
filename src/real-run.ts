import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import type { ParticipantRecord } from './groups.js'
import { sameIdentity } from './identity.js'

export type RealRunStatus =
  | 'added'
  | 'invite_required'
  | 'forbidden'
  | 'rejected'
  | 'not_confirmed'
  | 'error'

export type RealRunResult = {
  attemptedAt: string
  status: RealRunStatus
  target: ParticipantRecord
  requestJid: string
  apiStatus: string
  confirmed: boolean
  error?: string
}

export function parseMaxUsers(raw?: string): number {
  if ((raw ?? '').trim() !== '1') {
    throw new Error('No teste real, MAX_USERS deve ser exatamente 1.')
  }
  return 1
}

export function selectPinnedCandidate(
  candidates: ParticipantRecord[],
  targetRaw?: string,
): ParticipantRecord {
  const target = targetRaw?.trim()
  if (!target) {
    throw new Error(
      'TARGET_PARTICIPANT é obrigatório no teste real. Informe o número/JID exato validado no DRY RUN.',
    )
  }

  const matches = candidates.filter((candidate) => sameIdentity(candidate, target))

  if (matches.length === 0) {
    throw new Error('TARGET_PARTICIPANT não corresponde a nenhum candidato atual. Execute novo DRY RUN.')
  }

  if (matches.length > 1) {
    throw new Error('TARGET_PARTICIPANT corresponde a mais de um candidato. Execução abortada.')
  }

  return matches[0]
}

export function participantRequestJid(participant: ParticipantRecord): string {
  return participant.phoneNumber || participant.id || participant.lid || ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasNodeTag(value: unknown, expectedTag: string): boolean {
  if (!value || typeof value !== 'object') return false

  const node = value as { tag?: unknown; content?: unknown }
  if (node.tag === expectedTag) return true

  if (Array.isArray(node.content)) {
    return node.content.some((child) => hasNodeTag(child, expectedTag))
  }

  return false
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function executeSingleAdd(
  sock: Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>,
  destinationJid: string,
  candidate: ParticipantRecord,
  options?: {
    confirmationAttempts?: number
    confirmationDelayMs?: number
    fetchDestination?: () => Promise<GroupMetadata>
  },
): Promise<RealRunResult> {
  const attemptedAt = new Date().toISOString()
  const requestJid = participantRequestJid(candidate)

  if (!requestJid) {
    return {
      attemptedAt,
      status: 'error',
      target: candidate,
      requestJid: '',
      apiStatus: 'not_sent',
      confirmed: false,
      error: 'Candidato sem JID utilizável para a operação.',
    }
  }

  try {
    const responses = await sock.groupParticipantsUpdate(destinationJid, [requestJid], 'add')
    const response = responses[0]
    const apiStatus = response?.status ?? 'no_response'

    if (apiStatus === '403') {
      const inviteRequired = hasNodeTag(response?.content, 'add_request')

      return {
        attemptedAt,
        status: inviteRequired ? 'invite_required' : 'forbidden',
        target: candidate,
        requestJid,
        apiStatus,
        confirmed: false,
        error: inviteRequired
          ? 'O WhatsApp devolveu add_request: a adição direta foi bloqueada e o participante precisa de convite. Nenhuma nova tentativa automática será feita.'
          : 'O WhatsApp recusou a operação com 403 sem add_request. Isso é compatível com falta de permissão no grupo ou outra restrição do servidor. Nenhuma nova tentativa automática será feita.',
      }
    }

    if (apiStatus !== '200') {
      return {
        attemptedAt,
        status: 'rejected',
        target: candidate,
        requestJid,
        apiStatus,
        confirmed: false,
      }
    }

    const attempts = Math.min(5, Math.max(1, options?.confirmationAttempts ?? 3))
    const delayMs = Math.min(5000, Math.max(0, options?.confirmationDelayMs ?? 1200))
    const fetchDestination = options?.fetchDestination ?? (() => sock.groupMetadata(destinationJid))

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const refreshed = await fetchDestination()
      const confirmed = refreshed.participants.some((participant) =>
        sameIdentity(candidate, participant),
      )

      if (confirmed) {
        return {
          attemptedAt,
          status: 'added',
          target: candidate,
          requestJid,
          apiStatus,
          confirmed: true,
        }
      }

      if (attempt < attempts && delayMs > 0) {
        await wait(delayMs)
      }
    }

    return {
      attemptedAt,
      status: 'not_confirmed',
      target: candidate,
      requestJid,
      apiStatus,
      confirmed: false,
      error: 'O WhatsApp respondeu 200, mas o participante não apareceu no Grupo B após a confirmação.',
    }
  } catch (error) {
    return {
      attemptedAt,
      status: 'error',
      target: candidate,
      requestJid,
      apiStatus: 'exception',
      confirmed: false,
      error: errorMessage(error),
    }
  }
}
