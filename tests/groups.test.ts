import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupMetadata, GroupParticipant } from '@whiskeysockets/baileys'
import { analyzeMigration, isCurrentUserAdmin } from '../src/groups.js'

function participant(
  id: string,
  extra: Partial<GroupParticipant> = {},
): GroupParticipant {
  return { id, ...extra } as GroupParticipant
}

function group(
  id: string,
  participants: GroupParticipant[],
  extra: Partial<GroupMetadata> = {},
): GroupMetadata {
  return {
    id,
    subject: id,
    creation: 0,
    owner: undefined,
    desc: undefined,
    participants,
    ...extra,
  } as GroupMetadata
}

test('reconhece conta administradora por alias PN/LID', () => {
  const metadata = group('a@g.us', [
    participant('900@lid', {
      phoneNumber: '5593999990000@s.whatsapp.net',
      admin: 'admin',
    }),
  ])

  assert.equal(
    isCurrentUserAdmin(metadata, ['5593999990000@s.whatsapp.net']),
    true,
  )
})

test('remove admin, owner, self, exclusão manual, já existente e duplicado', () => {
  const source = group(
    'source@g.us',
    [
      participant('1@s.whatsapp.net', { admin: 'admin' }),
      participant('2@s.whatsapp.net'),
      participant('3@s.whatsapp.net'),
      participant('4@lid', { phoneNumber: '4@s.whatsapp.net' }),
      participant('5@s.whatsapp.net'),
      participant('5@lid', { phoneNumber: '5@s.whatsapp.net' }),
      participant('6@s.whatsapp.net'),
      participant('7@s.whatsapp.net'),
    ],
    { owner: '7@s.whatsapp.net' },
  )

  const destination = group('destination@g.us', [
    participant('400@lid', { phoneNumber: '4@s.whatsapp.net' }),
  ])

  const analysis = analyzeMigration(source, destination, {
    selfJids: ['2@s.whatsapp.net'],
    excludedJids: ['3@s.whatsapp.net'],
  })

  assert.equal(analysis.adminOrOwnerSkipped.length, 2)
  assert.equal(analysis.selfSkipped.length, 1)
  assert.equal(analysis.manuallyExcluded.length, 1)
  assert.equal(analysis.alreadyInDestination.length, 1)
  assert.equal(analysis.duplicateSourceSkipped.length, 1)
  assert.deepEqual(analysis.candidates.map((item) => item.id), [
    '5@s.whatsapp.net',
    '6@s.whatsapp.net',
  ])
})

test('recusa origem e destino iguais', () => {
  const same = group('same@g.us', [])
  assert.throws(
    () => analyzeMigration(same, same, { selfJids: [] }),
    /precisam ser diferentes/,
  )
})
