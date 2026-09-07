import assert from 'node:assert/strict'
import test from 'node:test'
import type { ParticipantRecord } from '../src/groups.js'
import {
  createEmptyCheckpoint,
  recordCheckpointResult,
  selectAutomaticCandidates,
  wasProcessed,
} from '../src/auto-batch.js'
import type { RealRunResult } from '../src/real-run.js'

const a: ParticipantRecord = {
  id: '100@lid',
  phoneNumber: '5511000000001@s.whatsapp.net',
  lid: '100@lid',
  admin: null,
}

const b: ParticipantRecord = {
  id: '200@lid',
  phoneNumber: '5511000000002@s.whatsapp.net',
  lid: '200@lid',
  admin: null,
}

const c: ParticipantRecord = {
  id: '300@lid',
  phoneNumber: '5511000000003@s.whatsapp.net',
  lid: '300@lid',
  admin: null,
}

const lidOnly: ParticipantRecord = {
  id: '400@lid',
  phoneNumber: undefined,
  lid: undefined,
  admin: null,
}

test('selectAutomaticCandidates pega somente pendentes com telefone conhecido e respeita limite', () => {
  const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
  const selected = selectAutomaticCandidates([lidOnly, a, b, c], checkpoint, 2)
  assert.deepEqual(selected.map((item) => item.id), [a.id, b.id])
})

test('checkpoint impede nova seleção do mesmo participante por qualquer alias', () => {
  const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
  const result: RealRunResult = {
    attemptedAt: '2026-09-07T16:00:00.000Z',
    status: 'invite_required',
    target: a,
    requestJid: a.phoneNumber!,
    apiStatus: '403',
    confirmed: false,
  }

  recordCheckpointResult(checkpoint, result)

  assert.equal(wasProcessed(a, checkpoint), true)
  const selected = selectAutomaticCandidates([a, b], checkpoint, 5)
  assert.deepEqual(selected.map((item) => item.id), [b.id])
})

test('checkpoint reconhece o mesmo participante mesmo se vier só pelo LID', () => {
  const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
  recordCheckpointResult(checkpoint, {
    attemptedAt: '2026-09-07T16:00:00.000Z',
    status: 'added',
    target: a,
    requestJid: a.phoneNumber!,
    apiStatus: '200',
    confirmed: true,
  })

  const sameByLidOnly: ParticipantRecord = {
    id: '100@lid',
    phoneNumber: undefined,
    lid: undefined,
    admin: null,
  }

  assert.equal(wasProcessed(sameByLidOnly, checkpoint), true)
})

test('AUTO_BATCH ignora candidato LID-only mesmo se estiver pendente', () => {
  const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
  const selected = selectAutomaticCandidates([lidOnly, a], checkpoint, 5)
  assert.deepEqual(selected.map((item) => item.id), [a.id])
})

test('AUTO_BATCH rejeita limite acima de 5', () => {
  const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
  assert.throws(() => selectAutomaticCandidates([a], checkpoint, 6), /no máximo 5/i)
})
