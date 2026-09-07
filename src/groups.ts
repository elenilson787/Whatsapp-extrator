import type { WASocket, GroupMetadata } from '@whiskeysockets/baileys'

export type GroupSummary = {
  id: string
  name: string
  size: number
  isAdmin: boolean
}

function isAdmin(group: GroupMetadata, myJid?: string): boolean {
  if (!myJid) return false
  const me = group.participants.find((p) => p.id === myJid)
  return Boolean(me?.admin)
}

export async function listGroups(sock: WASocket): Promise<GroupSummary[]> {
  const groups = await sock.groupFetchAllParticipating()
  const myJid = sock.user?.id

  return Object.values(groups)
    .map((group) => ({
      id: group.id,
      name: group.subject || '(sem nome)',
      size: group.participants?.length ?? group.size ?? 0,
      isAdmin: isAdmin(group, myJid),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export async function getGroup(sock: WASocket, jid: string): Promise<GroupMetadata> {
  return sock.groupMetadata(jid)
}

export function participantsNotInDestination(
  source: GroupMetadata,
  destination: GroupMetadata,
): string[] {
  const destinationIds = new Set(destination.participants.map((p) => p.id))
  return source.participants
    .map((p) => p.id)
    .filter((jid) => !destinationIds.has(jid))
}
