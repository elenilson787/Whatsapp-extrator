import type { GroupMetadata } from '@whiskeysockets/baileys'

export type DestinationAddPermission =
  | 'admin'
  | 'members_allowed'
  | 'admins_only'
  | 'unknown'

export function destinationAddPermission(
  destination: GroupMetadata,
  isAdmin: boolean,
): DestinationAddPermission {
  if (isAdmin) return 'admin'
  if (destination.memberAddMode === true) return 'members_allowed'
  if (destination.memberAddMode === false) return 'admins_only'
  return 'unknown'
}

export function destinationAddPermissionLabel(
  permission: DestinationAddPermission,
): string {
  switch (permission) {
    case 'admin':
      return 'ADMIN — inclusão permitida pela função administrativa'
    case 'members_allowed':
      return 'MEMBRO — o grupo permite que membros adicionem participantes'
    case 'admins_only':
      return 'MEMBRO — somente admins podem adicionar participantes'
    case 'unknown':
      return 'MEMBRO — permissão não informada pelo metadata'
  }
}

export function assertDestinationCanAttempt(
  permission: DestinationAddPermission,
  allowUnknownNonAdmin: boolean,
): void {
  if (permission === 'admins_only') {
    throw new Error(
      'Grupo B bloqueia inclusão por membros (memberAddMode=false). Operação abortada antes de chamar o WhatsApp.',
    )
  }

  if (permission === 'unknown' && !allowUnknownNonAdmin) {
    throw new Error(
      'Não foi possível determinar memberAddMode do Grupo B. Para um teste controlado dessa permissão, defina ALLOW_NON_ADMIN_DESTINATION=true.',
    )
  }
}
