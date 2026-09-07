import type { BatchRunResult } from './batch-run.js'

export type OperatorMode = 'preview' | 'run' | 'exit'
export type OperatorMainMenu = 'new' | 'continue' | 'status' | 'history' | 'exit'

export function parseOperatorMainMenu(raw: string): OperatorMainMenu {
  const value = raw.trim().toLowerCase()
  if (['1', 'n', 'nova', 'novo', 'new'].includes(value)) return 'new'
  if (['2', 'c', 'continuar', 'continue'].includes(value)) return 'continue'
  if (['3', 'status', 'fila'].includes(value)) return 'status'
  if (['4', 'h', 'historico', 'histórico', 'history'].includes(value)) return 'history'
  if (['5', 's', 'sair', 'exit'].includes(value)) return 'exit'
  throw new Error('Escolha 1 para nova operação, 2 para continuar, 3 para status, 4 para histórico ou 5 para sair.')
}

export function parseOperatorMode(raw: string): OperatorMode {
  const value = raw.trim().toLowerCase()
  if (['1', 'p', 'preview', 'previa', 'prévia'].includes(value)) return 'preview'
  if (['2', 'r', 'run', 'executar', 'lote'].includes(value)) return 'run'
  if (['3', 's', 'sair', 'exit'].includes(value)) return 'exit'
  throw new Error('Escolha 1 para prévia, 2 para lote autorizado ou 3 para sair.')
}

export function parseOperatorBatchSize(raw: string): number {
  const value = raw.trim()
  if (!value) return 2
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 5) {
    throw new Error('A quantidade deve ser um inteiro entre 2 e 5.')
  }
  return parsed
}

export function parseOperatorDelaySeconds(raw: string): number {
  const value = raw.trim()
  if (!value) return 15
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 120) {
    throw new Error('O intervalo deve ser um número inteiro entre 10 e 120 segundos.')
  }
  return parsed
}

export function hasAuthorizationConfirmation(raw: string): boolean {
  return raw.trim().toUpperCase() === 'AUTORIZADO'
}

export function hasExecutionConfirmation(raw: string): boolean {
  return raw.trim().toUpperCase() === 'EXECUTAR'
}

export function operatorDashboardLines(
  result: BatchRunResult,
  pendingAfter: number,
): string[] {
  const summary = result.summary
  const failed =
    summary.permission_denied +
    summary.forbidden +
    summary.rejected +
    summary.not_confirmed +
    summary.error

  return [
    '[PAINEL FINAL]',
    `✅ Adicionados: ${summary.added}`,
    `📨 Convite necessário: ${summary.invite_required}`,
    `⚠️ Resultado incerto: ${summary.outcome_unknown}`,
    `❌ Falhas: ${failed}`,
    `🔁 Tentados: ${result.attempted}/${result.requested}`,
    `⏭️ Pendentes: ${pendingAfter}`,
    ...(result.stopReason ? [`🛑 Parada segura: ${result.stopReason}`] : []),
  ]
}
