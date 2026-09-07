import type {
  WASocket,
  GroupMetadata,
  GroupParticipant,
} from '@whiskeysockets/baileys'
import { sameIdentity } from './identity.js'

export type GroupSummary = {
  id: string
  name: string
  size: number
  isAdmin: boolean
}

export type ParticipantRecord = Pick<
  GroupParticipant,
  'id' | 'phoneNumber' | 'lid' | 'admin'
>

export type MigrationAnalysis = {
  sourceTotal: number
  destinationTotal: number
  adminOrOwnerSkipped: ParticipantRecord[]
  selfSkipped: ParticipantRecord[]
  manuallyExcluded: ParticipantRecord[]
  alreadyInDestination: ParticipantRecord[]
  duplicateSourceSkipped: ParticipantRecord[]
  candidates: ParticipantRecord[]
}

function isOwner(group: GroupMetadata, participant: ParticipantRecord): boolean {
  return Boolean(
    (group.owner && sameIdentity(participant, group.owner)) ||
      (group.ownerPn && sameIdentity(participant, group.ownerPn)),
  )
}

export function isPrivilegedParticipant(
  group: GroupMetadata,
  participant: ParticipantRecord,
): boolean {
  return Boolean(participant.admin) || isOwner(group, participant)
}

export function findSelfParticipant(
  group: GroupMetadata,
  selfJids: string[],
): GroupParticipant | undefined {
  return group.participants.find((participant) =>
    selfJids.some((selfJid) => sameIdentity(participant, selfJid)),
  )
}

export function isCurrentUserAdmin(group: GroupMetadata, selfJids: string[]): boolean {
  const me = findSelfParticipant(group, selfJids)
  return Boolean(me && isPrivilegedParticipant(group, me))
}

export async function listGroups(sock: WASocket): Promise<GroupSummary[]> {
  const groups = await sock.groupFetchAllParticipating()
  const account = sock.user as { id?: string; lid?: string } | undefined
  const selfJids = [account?.id, account?.lid].filter(
    (value): value is string => Boolean(value),
  )

  return Object.values(groups)
    .map((group) => ({
      id: group.id,
      name: group.subject || '(sem nome)',
      size: group.participants?.length ?? group.size ?? 0,
      isAdmin: isCurrentUserAdmin(group, selfJids),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export async function getGroup(sock: WASocket, jid: string): Promise<GroupMetadata> {
  return sock.groupMetadata(jid)
}

export function analyzeMigration(
  source: GroupMetadata,
  destination: GroupMetadata,
  options: { selfJids: string[]; excludedJids?: string[] },
): MigrationAnalysis {
  if (source.id === destination.id) {
    throw new Error('Grupo A e Grupo B precisam ser diferentes.')
  }

  const result: MigrationAnalysis = {
    sourceTotal: source.participants.length,
    destinationTotal: destination.participants.length,
    adminOrOwnerSkipped: [],
    selfSkipped: [],
    manuallyExcluded: [],
    alreadyInDestination: [],
    duplicateSourceSkipped: [],
    candidates: [],
  }

  const excluded = options.excludedJids ?? []

  for (const participant of source.participants) {
    if (isPrivilegedParticipant(source, participant)) {
      result.adminOrOwnerSkipped.push(participant)
      continue
    }

    if (options.selfJids.some((selfJid) => sameIdentity(participant, selfJid))) {
      result.selfSkipped.push(participant)
      continue
    }

    if (excluded.some((excludedJid) => sameIdentity(participant, excludedJid))) {
      result.manuallyExcluded.push(participant)
      continue
    }

    if (
      destination.participants.some((destinationParticipant) =>
        sameIdentity(participant, destinationParticipant),
      )
    ) {
      result.alreadyInDestination.push(participant)
      continue
    }

    if (result.candidates.some((candidate) => sameIdentity(participant, candidate))) {
      result.duplicateSourceSkipped.push(participant)
      continue
    }

    result.candidates.push(participant)
  }

  return result
}
