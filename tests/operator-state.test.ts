import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadOperatorHistory,
  loadOperatorState,
  saveLastPair,
} from '../src/operator-state.js'

test('estado do operador começa vazio e persiste último par', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whatsapp-operator-state-'))
  const path = join(dir, 'operator-state.json')

  try {
    const empty = await loadOperatorState(path)
    assert.equal(empty.version, 1)
    assert.equal(empty.lastPair, undefined)

    await saveLastPair({
      sourceJid: 'source@g.us',
      destinationJid: 'destination@g.us',
      sourceName: 'Grupo A',
      destinationName: 'Grupo B',
    }, path)

    const saved = await loadOperatorState(path)
    assert.equal(saved.lastPair?.sourceJid, 'source@g.us')
    assert.equal(saved.lastPair?.destinationJid, 'destination@g.us')
    assert.equal(saved.lastPair?.sourceName, 'Grupo A')
    assert.ok(saved.lastPair?.updatedAt)

    const raw = JSON.parse(await readFile(path, 'utf8')) as { version: number }
    assert.equal(raw.version, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('histórico lê relatórios novos e antigos e ignora JSON corrompido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whatsapp-operator-history-'))
  const reports = join(dir, 'reports')
  await mkdir(reports, { recursive: true })

  try {
    await writeFile(
      join(reports, 'batch-run-2026-09-07T18-30-00-000Z.json'),
      JSON.stringify({
        generatedAt: '2026-09-07T18:30:00.000Z',
        source: { subject: 'Origem nova' },
        destination: { subject: 'Destino novo' },
        attempted: 2,
        requested: 2,
        summary: {
          added: 1,
          invite_required: 1,
          permission_denied: 0,
          forbidden: 0,
          rejected: 0,
          not_confirmed: 0,
          outcome_unknown: 0,
          error: 0,
        },
        results: [],
      }),
      'utf8',
    )

    await writeFile(
      join(reports, 'batch-run-2026-09-07T18-20-00-000Z.json'),
      JSON.stringify({
        generatedAt: '2026-09-07T18:20:00.000Z',
        source: { subject: 'Origem antiga' },
        destination: { subject: 'Destino antigo' },
        results: [
          { status: 'added' },
          { status: 'permission_denied' },
        ],
      }),
      'utf8',
    )

    await writeFile(
      join(reports, 'batch-run-2026-09-07T18-10-00-000Z.json'),
      '{json quebrado',
      'utf8',
    )

    const history = await loadOperatorHistory(reports, 10)
    assert.equal(history.length, 2)
    assert.equal(history[0]?.sourceName, 'Origem nova')
    assert.equal(history[0]?.summary.added, 1)
    assert.equal(history[0]?.summary.invite_required, 1)
    assert.equal(history[1]?.sourceName, 'Origem antiga')
    assert.equal(history[1]?.summary.added, 1)
    assert.equal(history[1]?.summary.permission_denied, 1)
    assert.equal(history[1]?.attempted, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
