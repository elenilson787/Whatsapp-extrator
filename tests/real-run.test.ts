import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import type { ParticipantRecord } from '../src/groups.js'
import {
  executeSingleAdd,
  parseMaxUsers,
  participantRequestJid,
  selectPinnedCandidate,
} from '../src/real-run.js'

const candidate: ParticipantRecord = {
  id: '106945021214761@lid',
  phoneNumber: '557791457500@s.whatsapp.net',
  lid: undefined,
  admin: null,
}

test('parseMaxUsers aceita somente 1', () => {
  assert.equal(parseMaxUsers('1'), 1)
  assert.throws(() => parseMaxUsers('2'))
  assert.throws(() => parseMaxUsers(undefined))
})

test('selectPinnedCandidate encontra candidato pelo phoneNumber', () => {
  const selected = selectPinnedCandidate([candidate], '557791457500')
  assert.equal(selected.id, candidate.id)
})

test('selectPinnedCandidate aborta se o alvo não estiver entre os candidatos', () => {
  assert.throws(() => selectPinnedCandidate([candidate], '5599999999999'))
})

test('participantRequestJid prefere phoneNumber', () => {
  assert.equal(participantRequestJid(candidate), '557791457500@s.whatsapp.net')
})

test('executeSingleAdd classifica 403 com add_request como invite_required', async () => {
  let metadataCalls = 0
  const sock = {
    groupParticipantsUpdate: async () => [
      {
        status: '403',
        jid: candidate.phoneNumber!,
        content: {
          tag: 'participant',
          attrs: {},
          content: [{ tag: 'add_request', attrs: { code: 'x' } }],
        } as never,
      },
    ],
    groupMetadata: async () => {
      metadataCalls += 1
      return { participants: [] } as unknown as GroupMetadata
    },
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeSingleAdd(sock, 'grupo@g.us', candidate)
  assert.equal(result.status, 'invite_required')
  assert.equal(result.apiStatus, '403')
  assert.equal(result.confirmed, false)
  assert.match(result.error ?? '', /convite/i)
  assert.equal(metadataCalls, 0)
})

test('executeSingleAdd classifica 403 sem add_request como forbidden', async () => {
  const sock = {
    groupParticipantsUpdate: async () => [
      { status: '403', jid: candidate.phoneNumber!, content: {} as never },
    ],
    groupMetadata: async () => ({ participants: [] }) as unknown as GroupMetadata,
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeSingleAdd(sock, 'grupo@g.us', candidate)
  assert.equal(result.status, 'forbidden')
  assert.equal(result.apiStatus, '403')
  assert.equal(result.confirmed, false)
  assert.match(result.error ?? '', /permissão|restrição/i)
})

test('executeSingleAdd mantém outros status não-200 como rejected', async () => {
  const sock = {
    groupParticipantsUpdate: async () => [
      { status: '500', jid: candidate.phoneNumber!, content: {} as never },
    ],
    groupMetadata: async () => ({ participants: [] }) as unknown as GroupMetadata,
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeSingleAdd(sock, 'grupo@g.us', candidate)
  assert.equal(result.status, 'rejected')
  assert.equal(result.apiStatus, '500')
  assert.equal(result.confirmed, false)
})

test('executeSingleAdd confirma membro após resposta 200', async () => {
  const sock = {
    groupParticipantsUpdate: async () => [
      { status: '200', jid: candidate.phoneNumber!, content: {} as never },
    ],
    groupMetadata: async () =>
      ({
        participants: [candidate],
      }) as unknown as GroupMetadata,
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeSingleAdd(sock, 'grupo@g.us', candidate, {
    confirmationAttempts: 1,
    confirmationDelayMs: 0,
  })

  assert.equal(result.status, 'added')
  assert.equal(result.confirmed, true)
  assert.equal(result.apiStatus, '200')
})

test('executeSingleAdd não marca added sem confirmação no grupo', async () => {
  const sock = {
    groupParticipantsUpdate: async () => [
      { status: '200', jid: candidate.phoneNumber!, content: {} as never },
    ],
    groupMetadata: async () =>
      ({
        participants: [],
      }) as unknown as GroupMetadata,
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeSingleAdd(sock, 'grupo@g.us', candidate, {
    confirmationAttempts: 1,
    confirmationDelayMs: 0,
  })

  assert.equal(result.status, 'not_confirmed')
  assert.equal(result.confirmed, false)
})
