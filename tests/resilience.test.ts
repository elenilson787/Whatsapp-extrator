import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys'
import type { ParticipantRecord } from '../src/groups.js'
import { executeSingleAdd } from '../src/real-run.js'
import type { RealRunResult } from '../src/real-run.js'
import {
  executeControlledBatch,
  summarizeBatchResults,
} from '../src/batch-run.js'
import {
  createEmptyCheckpoint,
  loadAutoCheckpoint,
  recordCheckpointResult,
  saveAutoCheckpoint,
  selectAutomaticCandidates,
} from '../src/auto-batch.js'
import { isTransientReadError } from '../src/whatsapp.js'

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

function mockedSock(
  add: Pick<WASocket, 'groupParticipantsUpdate'>['groupParticipantsUpdate'],
): Pick<WASocket, 'groupParticipantsUpdate' | 'groupMetadata'> {
  return {
    groupParticipantsUpdate: add,
    groupMetadata: async () => ({ participants: [] }) as unknown as GroupMetadata,
  }
}

test('queda durante add vira outcome_unknown e nunca é tratada como retry seguro', async () => {
  const sock = mockedSock(async () => {
    throw new Error('Connection Closed')
  })

  const result = await executeSingleAdd(sock, 'dest@g.us', a, {
    confirmationAttempts: 1,
    confirmationDelayMs: 0,
  })

  assert.equal(result.status, 'outcome_unknown')
  assert.equal(result.apiStatus, 'exception_during_add')
  assert.equal(result.confirmed, false)
  assert.match(result.error ?? '', /não será repetido automaticamente/i)
})

test('resposta 200 com queda em todas as leituras de confirmação vira outcome_unknown', async () => {
  const sock = mockedSock(async () => [
    { status: '200', jid: a.phoneNumber!, content: {} as never },
  ])

  const result = await executeSingleAdd(sock, 'dest@g.us', a, {
    confirmationAttempts: 2,
    confirmationDelayMs: 0,
    fetchDestination: async () => {
      throw new Error('Connection Closed')
    },
  })

  assert.equal(result.status, 'outcome_unknown')
  assert.equal(result.apiStatus, '200')
  assert.equal(result.confirmed, false)
  assert.match(result.error ?? '', /não foi possível reler/i)
})

test('lote para no primeiro outcome_unknown, persiste antes de parar e não tenta o próximo', async () => {
  let addCalls = 0
  let persisted = 0
  let waits = 0

  const sock = mockedSock(async () => {
    addCalls += 1
    throw new Error('Connection Closed')
  })

  const result = await executeControlledBatch(sock, 'dest@g.us', [a, b], {
    maxUsers: 2,
    delayMs: 15000,
    waitFn: async () => {
      waits += 1
    },
    onResult: async () => {
      persisted += 1
    },
  })

  assert.equal(addCalls, 1)
  assert.equal(persisted, 1)
  assert.equal(waits, 0)
  assert.equal(result.attempted, 1)
  assert.equal(result.stoppedEarly, true)
  assert.equal(result.results[0]?.status, 'outcome_unknown')
  assert.equal(result.summary.outcome_unknown, 1)
})

test('checkpoint salvo após outcome_unknown impede repetição depois de restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whatsapp-extrator-'))
  const checkpointDir = join(root, 'checkpoints')

  try {
    const checkpoint = createEmptyCheckpoint('source@g.us', 'dest@g.us')
    const result: RealRunResult = {
      attemptedAt: '2026-09-07T18:00:00.000Z',
      status: 'outcome_unknown',
      target: a,
      requestJid: a.phoneNumber!,
      apiStatus: 'exception_during_add',
      confirmed: false,
      error: 'Connection Closed',
    }

    recordCheckpointResult(checkpoint, result)
    await saveAutoCheckpoint(checkpoint, checkpointDir)

    const reloaded = await loadAutoCheckpoint('source@g.us', 'dest@g.us', checkpointDir)
    const next = selectAutomaticCandidates(
      [a, b],
      reloaded,
      2,
      [a.phoneNumber!, b.phoneNumber!],
    )

    assert.deepEqual(next.map((item) => item.id), [b.id])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resumo consolida todos os estados relevantes do lote', () => {
  const base = {
    attemptedAt: '2026-09-07T18:00:00.000Z',
    target: a,
    requestJid: a.phoneNumber!,
    confirmed: false,
  }

  const results: RealRunResult[] = [
    { ...base, status: 'added', apiStatus: '200', confirmed: true },
    { ...base, status: 'invite_required', apiStatus: '403' },
    { ...base, status: 'outcome_unknown', apiStatus: 'exception_during_add' },
    { ...base, status: 'error', apiStatus: 'not_sent' },
  ]

  const summary = summarizeBatchResults(results)
  assert.equal(summary.added, 1)
  assert.equal(summary.invite_required, 1)
  assert.equal(summary.outcome_unknown, 1)
  assert.equal(summary.error, 1)
  assert.equal(summary.permission_denied, 0)
})

test('somente erros transitórios de conexão são elegíveis para retry de leitura', () => {
  assert.equal(isTransientReadError(new Error('Connection Closed')), true)
  assert.equal(isTransientReadError(new Error('socket hang up')), true)
  assert.equal(isTransientReadError(new Error('permission denied')), false)
})
