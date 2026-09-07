import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import type { ParticipantRecord } from '../src/groups.js'
import {
  executeControlledBatch,
  parseBatchMaxUsers,
  parseTargetPhones,
  selectPinnedCandidates,
} from '../src/batch-run.js'

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

test('parseBatchMaxUsers aceita apenas 2 a 5', () => {
  assert.equal(parseBatchMaxUsers('2'), 2)
  assert.equal(parseBatchMaxUsers('5'), 5)
  assert.throws(() => parseBatchMaxUsers('1'))
  assert.throws(() => parseBatchMaxUsers('6'))
})

test('parseTargetPhones remove formatação e rejeita duplicados', () => {
  assert.deepEqual(parseTargetPhones('+55 (11) 00000-0001;5511000000002'), [
    '5511000000001',
    '5511000000002',
  ])
  assert.throws(() => parseTargetPhones('5511000000001,5511000000001'), /duplicados/i)
})

test('selectPinnedCandidates exige alvos válidos e preserva ordem', () => {
  const selected = selectPinnedCandidates(
    [a, b],
    [
      { phoneNumber: b.phoneNumber },
      { phoneNumber: a.phoneNumber },
    ],
    5,
  )
  assert.deepEqual(selected.map((item) => item.id), [b.id, a.id])
  assert.throws(
    () => selectPinnedCandidates([a], [{ phoneNumber: '5599999999999@s.whatsapp.net' }], 5),
    /não corresponde/i,
  )
})

test('lote continua após invite_required mas para em permission_denied', async () => {
  let calls = 0
  const sock = {
    groupParticipantsUpdate: async (_jid: string, participants: string[]) => {
      calls += 1
      if (participants[0] === a.phoneNumber) {
        return [{
          status: '403',
          jid: a.phoneNumber!,
          content: {
            tag: 'participant',
            attrs: {},
            content: [{ tag: 'add_request', attrs: { code: 'x' } }],
          } as never,
        }]
      }
      if (participants[0] === b.phoneNumber) {
        return [{ status: '421', jid: b.phoneNumber!, content: {} as never }]
      }
      return [{ status: '200', jid: c.phoneNumber!, content: {} as never }]
    },
    groupMetadata: async () => ({ participants: [c] }) as unknown as GroupMetadata,
  } as unknown as Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'>

  const result = await executeControlledBatch(sock, 'dest@g.us', [a, b, c], {
    maxUsers: 5,
    delayMs: 1,
  })

  assert.equal(calls, 2)
  assert.equal(result.attempted, 2)
  assert.equal(result.stoppedEarly, true)
  assert.equal(result.results[0]?.status, 'invite_required')
  assert.equal(result.results[1]?.status, 'permission_denied')
})
