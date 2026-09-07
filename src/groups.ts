import type {
  WASocket,
  GroupMetadata,
  GroupParticipant,
} from '@whiskeysockets/baileys'
import { isLidUser } from '@whiskeysockets/baileys'
import { normalizeInputJid, sameIdentity } from './identity.js'

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

export type ResolvedPhoneIdentity = {
  phoneNumber: string
  lid?: string
}

type LidMappingResolver = {
  getPNsForLIDs: (
    lids: string[],
  ) => Promise<Array<{ lid: string; pn: string }> | null>
  getLIDForPN: (pn: string) => Promise<string | null>
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

function participantLid(participant: ParticipantRecord): string | undefined {
  for (const value of [participant.lid, participant.id]) {
    if (value && isLidUser(value)) {
      return normalizeInputJid(value)
    }
  }
  return undefined
}

export async function resolvePhoneIdentity(
  resolver: Pick<LidMappingResolver, 'getLIDForPN'>,
  rawPhone: string,
): Promise<ResolvedPhoneIdentity> {
  const phoneNumber = normalizeInputJid(rawPhone)

  if (!phoneNumber.endsWith('@s.whatsapp.net')) {
    throw new Error('TARGET_PHONE deve conter um número de telefone válido, com DDI e DDD.')
  }

  let lid: string | null = null
  try {
    lid = await resolver.getLIDForPN(phoneNumber)
  } catch {
    // O PN continua sendo uma identidade válida mesmo se a sessão não conseguir
    // consultar o alias LID. Apenas não liberamos correspondência por LID nesse caso.
  }

  return {
    phoneNumber,
    lid: lid ? normalizeInputJid(lid) : undefined,
  }
}

export async function enrichGroupPhoneNumbers(
  group: GroupMetadata,
  resolver: Pick<LidMappingResolver, 'getPNsForLIDs'>,
): Promise<GroupMetadata> {
  const lids = [
    ...new Set(
      group.participants
        .filter((participant) => !participant.phoneNumber)
        .map(participantLid)
        .filter((value): value is string => Boolean(value)),
    ),
  ]

  if (lids.length === 0) return group

  let mappings: Array<{ lid: string; pn: string }> | null
  try {
    mappings = await resolver.getPNsForLIDs(lids)
  } catch {
    // O enriquecimento é auxiliar. Se o armazenamento de aliases não puder
    // ser consultado, preservamos o metadata original e o DRY RUN continua.
    return group
  }

  if (!mappings?.length) return group

  const pnByLid = new Map(
    mappings.map(({ lid, pn }) => [normalizeInputJid(lid), normalizeInputJid(pn)]),
  )

  let changed = false
  const participants = group.participants.map((participant) => {
    if (participant.phoneNumber) return participant

    const lid = participantLid(participant)
    const phoneNumber = lid ? pnByLid.get(lid) : undefined
    if (!phoneNumber) return participant

    changed = true
    return {
      ...participant,
      phoneNumber,
      lid: participant.lid ?? lid,
    }
  })

  return changed ? { ...group, participants } : group
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
  const group = await sock.groupMetadata(jid)
  return enrichGroupPhoneNumbers(group, sock.signalRepository.lidMapping)
}

export async function resolveTargetPhone(
  sock: WASocket,
  rawPhone: string,
): Promise<ResolvedPhoneIdentity> {
  return resolvePhoneIdentity(sock.signalRepository.lidMapping, rawPhone)
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
