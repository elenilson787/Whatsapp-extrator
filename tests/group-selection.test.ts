import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupSummary } from '../src/groups.js'
import { chooseGroupPair, parseGroupChoice } from '../src/group-selection.js'

const groups: GroupSummary[] = [
  { id: 'a@g.us', name: 'Grupo A', size: 10, isAdmin: false },
  { id: 'b@g.us', name: 'Grupo B', size: 20, isAdmin: true },
  { id: 'c@g.us', name: 'Grupo C', size: 30, isAdmin: false },
]

function queuedAsk(responses: string[]) {
  let index = 0
  return async () => responses[index++] ?? ''
}

test('parseGroupChoice usa numeração humana iniciando em 1', () => {
  assert.equal(parseGroupChoice('1', groups).id, 'a@g.us')
  assert.equal(parseGroupChoice('3', groups).id, 'c@g.us')
  assert.throws(() => parseGroupChoice('0', groups), /entre 1 e 3/i)
  assert.throws(() => parseGroupChoice('4', groups), /entre 1 e 3/i)
  assert.throws(() => parseGroupChoice('abc', groups), /inválida/i)
})

test('chooseGroupPair escolhe origem e destino por número e confirma', async () => {
  const selected = await chooseGroupPair(groups, {}, queuedAsk(['2', '3', 's']))
  assert.equal(selected.source.id, 'b@g.us')
  assert.equal(selected.destination.id, 'c@g.us')
})

test('chooseGroupPair impede escolher o mesmo grupo como destino', async () => {
  const selected = await chooseGroupPair(groups, {}, queuedAsk(['1', '1', '2', 's']))
  assert.equal(selected.source.id, 'a@g.us')
  assert.equal(selected.destination.id, 'b@g.us')
})

test('chooseGroupPair respeita origem predefinida e pergunta apenas o destino', async () => {
  const selected = await chooseGroupPair(
    groups,
    { sourceJid: 'a@g.us' },
    queuedAsk(['3', 'sim']),
  )
  assert.equal(selected.source.id, 'a@g.us')
  assert.equal(selected.destination.id, 'c@g.us')
})
