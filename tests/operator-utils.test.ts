import assert from 'node:assert/strict'
import test from 'node:test'
import type { BatchRunResult } from '../src/batch-run.js'
import {
  hasAuthorizationConfirmation,
  hasExecutionConfirmation,
  operatorDashboardLines,
  parseOperatorBatchSize,
  parseOperatorDelaySeconds,
  parseOperatorMainMenu,
  parseOperatorMode,
} from '../src/operator-utils.js'

test('parseOperatorMainMenu reconhece todas as opções do menu principal', () => {
  assert.equal(parseOperatorMainMenu('1'), 'new')
  assert.equal(parseOperatorMainMenu('nova'), 'new')
  assert.equal(parseOperatorMainMenu('2'), 'continue')
  assert.equal(parseOperatorMainMenu('continuar'), 'continue')
  assert.equal(parseOperatorMainMenu('3'), 'status')
  assert.equal(parseOperatorMainMenu('fila'), 'status')
  assert.equal(parseOperatorMainMenu('4'), 'history')
  assert.equal(parseOperatorMainMenu('histórico'), 'history')
  assert.equal(parseOperatorMainMenu('5'), 'exit')
  assert.throws(() => parseOperatorMainMenu('9'), /Escolha 1/i)
})

test('parseOperatorMode reconhece prévia, lote e sair', () => {
  assert.equal(parseOperatorMode('1'), 'preview')
  assert.equal(parseOperatorMode('prévia'), 'preview')
  assert.equal(parseOperatorMode('2'), 'run')
  assert.equal(parseOperatorMode('EXECUTAR'), 'run')
  assert.equal(parseOperatorMode('3'), 'exit')
  assert.throws(() => parseOperatorMode('9'), /Escolha 1/i)
})

test('parseOperatorBatchSize usa 2 como padrão e aceita somente 2 a 5', () => {
  assert.equal(parseOperatorBatchSize(''), 2)
  assert.equal(parseOperatorBatchSize('2'), 2)
  assert.equal(parseOperatorBatchSize('5'), 5)
  assert.throws(() => parseOperatorBatchSize('1'), /2 e 5/i)
  assert.throws(() => parseOperatorBatchSize('6'), /2 e 5/i)
})

test('parseOperatorDelaySeconds usa 15 como padrão e limita 10 a 120', () => {
  assert.equal(parseOperatorDelaySeconds(''), 15)
  assert.equal(parseOperatorDelaySeconds('10'), 10)
  assert.equal(parseOperatorDelaySeconds('120'), 120)
  assert.throws(() => parseOperatorDelaySeconds('9'), /10 e 120/i)
  assert.throws(() => parseOperatorDelaySeconds('121'), /10 e 120/i)
})

test('confirmações críticas exigem palavras exatas', () => {
  assert.equal(hasAuthorizationConfirmation('AUTORIZADO'), true)
  assert.equal(hasAuthorizationConfirmation(' autorizado '), true)
  assert.equal(hasAuthorizationConfirmation('sim'), false)
  assert.equal(hasExecutionConfirmation('EXECUTAR'), true)
  assert.equal(hasExecutionConfirmation('executar'), true)
  assert.equal(hasExecutionConfirmation('sim'), false)
})

test('painel final consolida resultados e pendentes', () => {
  const result: BatchRunResult = {
    startedAt: '2026-09-07T18:00:00.000Z',
    completedAt: '2026-09-07T18:01:00.000Z',
    maxUsers: 5,
    requested: 5,
    attempted: 5,
    stoppedEarly: false,
    summary: {
      added: 2,
      invite_required: 1,
      permission_denied: 1,
      forbidden: 0,
      rejected: 0,
      not_confirmed: 0,
      outcome_unknown: 1,
      error: 0,
    },
    results: [],
  }

  const lines = operatorDashboardLines(result, 17).join('\n')
  assert.match(lines, /Adicionados: 2/)
  assert.match(lines, /Convite necessário: 1/)
  assert.match(lines, /Resultado incerto: 1/)
  assert.match(lines, /Falhas: 1/)
  assert.match(lines, /Pendentes: 17/)
})
