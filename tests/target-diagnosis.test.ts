import assert from 'node:assert/strict'
import test from 'node:test'
import type { MigrationAnalysis, ParticipantRecord } from '../src/groups.js'
import { diagnoseTarget, targetDiagnosisMessage } from '../src/target-diagnosis.js'

function p(id: string, phoneNumber?: string): ParticipantRecord {
  return { id, phoneNumber, lid: undefined, admin: null }
}

function analysis(overrides: Partial<MigrationAnalysis> = {}): MigrationAnalysis {
  return {
    sourceTotal: 0,
    destinationTotal: 0,
    adminOrOwnerSkipped: [],
    selfSkipped: [],
    manuallyExcluded: [],
    alreadyInDestination: [],
    duplicateSourceSkipped: [],
    candidates: [],
    ...overrides,
  }
}

const target = {
  phoneNumber: '5511999999999@s.whatsapp.net',
  lid: '123456789@lid',
}

test('diagnostica candidato válido por alias LID', () => {
  const participant = p('123456789@lid')
  const result = diagnoseTarget(analysis({ candidates: [participant] }), target)
  assert.equal(result.code, 'candidate')
  assert.equal(result.participant, participant)
})

test('diagnostica alvo já presente no destino', () => {
  const participant = p('123456789@lid')
  const result = diagnoseTarget(
    analysis({ alreadyInDestination: [participant] }),
    target,
  )
  assert.equal(result.code, 'already_in_destination')
  assert.match(targetDiagnosisMessage(result.code), /já está no Grupo B/i)
})

test('diagnostica admin ou owner da origem', () => {
  const participant = p('123456789@lid')
  const result = diagnoseTarget(
    analysis({ adminOrOwnerSkipped: [participant] }),
    target,
  )
  assert.equal(result.code, 'admin_or_owner')
})

test('diagnostica número não encontrado na origem', () => {
  const result = diagnoseTarget(analysis(), target)
  assert.equal(result.code, 'not_in_source')
  assert.match(targetDiagnosisMessage(result.code), /não foi encontrado/i)
})
