import type {
  MigrationAnalysis,
  ParticipantRecord,
  ResolvedPhoneIdentity,
} from './groups.js'
import { sameIdentity } from './identity.js'

export type TargetDiagnosisCode =
  | 'candidate'
  | 'admin_or_owner'
  | 'self'
  | 'manually_excluded'
  | 'already_in_destination'
  | 'duplicate_source'
  | 'not_in_source'

export type TargetDiagnosis = {
  code: TargetDiagnosisCode
  participant?: ParticipantRecord
}

function findMatch(
  participants: ParticipantRecord[],
  target: ResolvedPhoneIdentity,
): ParticipantRecord | undefined {
  return participants.find((participant) => sameIdentity(participant, target))
}

export function diagnoseTarget(
  analysis: MigrationAnalysis,
  target: ResolvedPhoneIdentity,
): TargetDiagnosis {
  const candidate = findMatch(analysis.candidates, target)
  if (candidate) return { code: 'candidate', participant: candidate }

  const adminOrOwner = findMatch(analysis.adminOrOwnerSkipped, target)
  if (adminOrOwner) return { code: 'admin_or_owner', participant: adminOrOwner }

  const self = findMatch(analysis.selfSkipped, target)
  if (self) return { code: 'self', participant: self }

  const manuallyExcluded = findMatch(analysis.manuallyExcluded, target)
  if (manuallyExcluded) {
    return { code: 'manually_excluded', participant: manuallyExcluded }
  }

  const alreadyInDestination = findMatch(analysis.alreadyInDestination, target)
  if (alreadyInDestination) {
    return { code: 'already_in_destination', participant: alreadyInDestination }
  }

  const duplicateSource = findMatch(analysis.duplicateSourceSkipped, target)
  if (duplicateSource) {
    return { code: 'duplicate_source', participant: duplicateSource }
  }

  return { code: 'not_in_source' }
}

export function targetDiagnosisMessage(code: TargetDiagnosisCode): string {
  switch (code) {
    case 'candidate':
      return 'Candidato válido: está no Grupo A e não está no Grupo B.'
    case 'admin_or_owner':
      return 'Não elegível: é admin/owner do Grupo A.'
    case 'self':
      return 'Não elegível: é a própria conta conectada.'
    case 'manually_excluded':
      return 'Não elegível: está na lista de exclusões manuais.'
    case 'already_in_destination':
      return 'Não elegível: já está no Grupo B.'
    case 'duplicate_source':
      return 'Não elegível: identidade duplicada na origem.'
    case 'not_in_source':
      return 'Não elegível: esse número não foi encontrado entre os participantes do Grupo A.'
  }
}
