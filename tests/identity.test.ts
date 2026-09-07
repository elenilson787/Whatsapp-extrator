import assert from 'node:assert/strict'
import test from 'node:test'
import {
  identityJids,
  normalizeInputJid,
  parseExcludedIdentities,
  sameIdentity,
} from '../src/identity.js'

test('normaliza número puro como PN JID', () => {
  assert.equal(normalizeInputJid('+55 (93) 99999-0000'), '5593999990000@s.whatsapp.net')
})

test('compara participante LID com o PN alternativo', () => {
  const lidParticipant = {
    id: '987654321@lid',
    phoneNumber: '5593999990000@s.whatsapp.net',
  }
  const pnParticipant = {
    id: '5593999990000@s.whatsapp.net',
    lid: '987654321@lid',
  }

  assert.equal(sameIdentity(lidParticipant, pnParticipant), true)
})

test('mantém aliases distintos disponíveis para auditoria', () => {
  assert.deepEqual(
    identityJids({
      id: '987654321@lid',
      phoneNumber: '5593999990000@s.whatsapp.net',
    }),
    ['987654321@lid', '5593999990000@s.whatsapp.net'],
  )
})

test('parseia exclusões manuais separadas por vírgula, ponto e vírgula ou linha', () => {
  assert.deepEqual(parseExcludedIdentities('5511,5522;5533\n5544'), [
    '5511@s.whatsapp.net',
    '5522@s.whatsapp.net',
    '5533@s.whatsapp.net',
    '5544@s.whatsapp.net',
  ])
})
