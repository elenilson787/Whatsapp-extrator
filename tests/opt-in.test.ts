import assert from 'node:assert/strict'
import test from 'node:test'
import type { ParticipantRecord } from '../src/groups.js'
import {
  filterCandidatesByOptIn,
  normalizeOptInPhone,
  parseOptInCsv,
  parseOptInText,
} from '../src/opt-in.js'

const candidateA: ParticipantRecord = {
  id: '100@lid',
  phoneNumber: '5593981234567@s.whatsapp.net',
  lid: '100@lid',
  admin: null,
}

const candidateB: ParticipantRecord = {
  id: '200@lid',
  phoneNumber: '5511987654321@s.whatsapp.net',
  lid: '200@lid',
  admin: null,
}

test('normaliza telefone brasileiro com ou sem DDI 55', () => {
  assert.equal(
    normalizeOptInPhone('(93) 98123-4567'),
    '5593981234567@s.whatsapp.net',
  )
  assert.equal(
    normalizeOptInPhone('+55 93 98123-4567'),
    '5593981234567@s.whatsapp.net',
  )
})

test('parseOptInCsv encontra coluna WhatsApp em CSV de formulário', () => {
  const csv = [
    'Nome,WhatsApp,Interesse',
    'Ana,"(93) 98123-4567",Sim',
    'Bia,+55 11 98765-4321,Sim',
  ].join('\n')

  assert.deepEqual(parseOptInCsv(csv), [
    '5593981234567@s.whatsapp.net',
    '5511987654321@s.whatsapp.net',
  ])
})

test('parseOptInCsv aceita separador ponto e vírgula e coluna explícita', () => {
  const csv = [
    'Nome;Contato principal',
    'Ana;(93) 98123-4567',
  ].join('\n')

  assert.deepEqual(parseOptInCsv(csv, 'Contato principal'), [
    '5593981234567@s.whatsapp.net',
  ])
})

test('parseOptInText deduplica números', () => {
  const text = '(93) 98123-4567\n+55 93 98123-4567\n'
  assert.deepEqual(parseOptInText(text), [
    '5593981234567@s.whatsapp.net',
  ])
})

test('filterCandidatesByOptIn mantém somente candidatos autorizados', () => {
  const selected = filterCandidatesByOptIn(
    [candidateA, candidateB],
    ['5511987654321@s.whatsapp.net'],
  )
  assert.deepEqual(selected.map((item) => item.id), [candidateB.id])
})
