import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { WASocket, GroupMetadata } from '@whiskeysockets/baileys'
import { connectWhatsApp } from './whatsapp.js'
import {
  analyzeMigration,
  findSelfParticipant,
  getGroup,
  isCurrentUserAdmin,
  listGroups,
} from './groups.js'
import type { GroupSummary, MigrationAnalysis, ParticipantRecord } from './groups.js'
import { chooseGroupPair } from './group-selection.js'
import type { SelectedGroupPair } from './group-selection.js'
import {
  assertDestinationCanAttempt,
  destinationAddPermission,
  destinationAddPermissionLabel,
} from './destination-permission.js'
import type { DestinationAddPermission } from './destination-permission.js'
import {
  loadAutoCheckpoint,
  pendingAutomaticCandidates,
  recordCheckpointResult,
  saveAutoCheckpoint,
} from './auto-batch.js'
import type { AutoCheckpoint } from './auto-batch.js'
import { executeControlledBatch } from './batch-run.js'
import { writeBatchRunReport } from './batch-report.js'
import { writeDryRunReports } from './report.js'
import {
  hasAuthorizationConfirmation,
  hasExecutionConfirmation,
  operatorDashboardLines,
  parseOperatorBatchSize,
  parseOperatorDelaySeconds,
  parseOperatorMainMenu,
  parseOperatorMode,
} from './operator-utils.js'
import {
  loadOperatorHistory,
  loadOperatorState,
  saveLastPair,
} from './operator-state.js'
import type { OperatorLastPair, OperatorState } from './operator-state.js'

type Ask = (question: string) => Promise<string>

type PairContext = {
  source: GroupMetadata
  destination: GroupMetadata
  sourceIsAdmin: boolean
  destinationIsAdmin: boolean
  destinationMembership: ReturnType<typeof findSelfParticipant>
  destinationPermission: DestinationAddPermission
  analysis: MigrationAnalysis
  checkpoint: AutoCheckpoint
  pending: ParticipantRecord[]
}

function knownPhoneCount(participants: Array<{ phoneNumber?: string | null }>): number {
  return participants.filter((participant) => Boolean(participant.phoneNumber)).length
}

function checkpointProcessedCount(checkpoint: AutoCheckpoint): number {
  return new Set(
    Object.values(checkpoint.processed).map(
      (entry) => `${entry.attemptedAt}|${entry.requestJid}`,
    ),
  ).size
}

function printCandidate(index: number, participant: ParticipantRecord): void {
  console.log(
    `${index + 1}. id=${participant.id} phone=${participant.phoneNumber ?? '-'} lid=${participant.lid ?? '-'}`,
  )
}

async function askParsed<T>(
  ask: Ask,
  question: string,
  parser: (raw: string) => T,
): Promise<T> {
  while (true) {
    try {
      return parser(await ask(question))
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error))
    }
  }
}

function groupFromLastPair(
  groups: GroupSummary[],
  lastPair?: OperatorLastPair,
): SelectedGroupPair | undefined {
  if (!lastPair) return undefined

  const source = groups.find((group) => group.id === lastPair.sourceJid)
  const destination = groups.find((group) => group.id === lastPair.destinationJid)
  if (!source || !destination || source.id === destination.id) return undefined

  return { source, destination }
}

function printMainMenu(state: OperatorState): void {
  console.log('\n========================================')
  console.log('             MENU PRINCIPAL')
  console.log('========================================')

  if (state.lastPair) {
    console.log(`Última origem:  ${state.lastPair.sourceName}`)
    console.log(`Último destino: ${state.lastPair.destinationName}`)
  } else {
    console.log('Último par: ainda não definido')
  }

  console.log('\n[1] Nova operação')
  console.log('[2] Continuar último par de grupos')
  console.log('[3] Ver status da fila')
  console.log('[4] Ver histórico de execuções')
  console.log('[5] Sair')
}

function printGroups(groups: GroupSummary[]): void {
  console.log(`\nGrupos encontrados: ${groups.length}\n`)
  for (const [index, group] of groups.entries()) {
    console.log(
      `${index + 1}. ${group.name} | ${group.size} participantes | ${group.isAdmin ? 'ADMIN' : 'MEMBRO'}`,
    )
    console.log(`   JID: ${group.id}`)
  }
}

async function loadPairContext(
  sock: WASocket,
  pair: SelectedGroupPair,
): Promise<PairContext> {
  const [source, destination] = await Promise.all([
    getGroup(sock, pair.source.id),
    getGroup(sock, pair.destination.id),
  ])

  const account = sock.user as { id?: string; lid?: string } | undefined
  const selfJids = [account?.id, account?.lid].filter(
    (value): value is string => Boolean(value),
  )

  const sourceIsAdmin = isCurrentUserAdmin(source, selfJids)
  const destinationIsAdmin = isCurrentUserAdmin(destination, selfJids)
  const destinationMembership = findSelfParticipant(destination, selfJids)
  const destinationPermission = destinationAddPermission(destination, destinationIsAdmin)
  const analysis = analyzeMigration(source, destination, { selfJids })
  const checkpoint = await loadAutoCheckpoint(source.id, destination.id)
  const pending = pendingAutomaticCandidates(analysis.candidates, checkpoint)

  return {
    source,
    destination,
    sourceIsAdmin,
    destinationIsAdmin,
    destinationMembership,
    destinationPermission,
    analysis,
    checkpoint,
    pending,
  }
}

function printAnalysis(context: PairContext): void {
  const { source, destination, analysis } = context
  console.log('\n[ANÁLISE DO PAR]')
  console.log(`${source.subject} → ${destination.subject}`)
  console.log(`Conta no Grupo A: ${context.sourceIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
  console.log(`Conta no Grupo B: ${context.destinationIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
  console.log(`Permissão no Grupo B: ${destinationAddPermissionLabel(context.destinationPermission)}`)
  console.log(`Origem: ${analysis.sourceTotal}`)
  console.log(`Destino: ${analysis.destinationTotal}`)
  console.log(`PN conhecido na origem: ${knownPhoneCount(source.participants)}/${source.participants.length}`)
  console.log(`Admins/owner ignorados: ${analysis.adminOrOwnerSkipped.length}`)
  console.log(`Própria conta ignorada: ${analysis.selfSkipped.length}`)
  console.log(`Já no destino: ${analysis.alreadyInDestination.length}`)
  console.log(`Candidatos finais: ${analysis.candidates.length}`)
}

function printQueueStatus(context: PairContext): void {
  printAnalysis(context)
  console.log('\n[STATUS DA FILA]')
  console.log(`Checkpoint: ${checkpointProcessedCount(context.checkpoint)} participante(s) processado(s).`)
  console.log(
    `Fonte da fila: ${process.env.OPT_IN_FILE?.trim() ? `allowlist ${process.env.OPT_IN_FILE.trim()}` : 'telefones resolvidos do próprio Grupo A'}`,
  )
  console.log(`Pendentes elegíveis: ${context.pending.length}`)
  const preview = context.pending.slice(0, 5)
  console.log(`Próximos na fila: ${preview.length}`)
  preview.forEach((participant, index) => printCandidate(index, participant))
}

async function showHistory(): Promise<void> {
  const history = await loadOperatorHistory('reports', 10)
  console.log('\n[HISTÓRICO DE EXECUÇÕES]')

  if (history.length === 0) {
    console.log('Nenhuma execução em lote encontrada em reports/.')
    return
  }

  history.forEach((entry, index) => {
    const failed =
      entry.summary.permission_denied +
      entry.summary.forbidden +
      entry.summary.rejected +
      entry.summary.not_confirmed +
      entry.summary.outcome_unknown +
      entry.summary.error

    console.log(`\n${index + 1}. ${entry.generatedAt}`)
    console.log(`   ${entry.sourceName} → ${entry.destinationName}`)
    console.log(
      `   Tentados ${entry.attempted}/${entry.requested} | adicionados ${entry.summary.added} | convite ${entry.summary.invite_required} | falhas/incertos ${failed}`,
    )
    console.log(`   ${entry.file}`)
  })
}

async function runPairOperation(
  sock: WASocket,
  pair: SelectedGroupPair,
  ask: Ask,
): Promise<void> {
  console.log('\nCarregando metadados dos grupos...')
  const context = await loadPairContext(sock, pair)
  printAnalysis(context)

  const dryReport = await writeDryRunReports(
    context.source,
    context.destination,
    context.analysis,
  )
  console.log(`Relatório DRY JSON: ${dryReport.jsonPath}`)

  console.log('\n[MODO]')
  console.log('1. Apenas prévia segura')
  console.log('2. Lote autorizado')
  console.log('3. Voltar ao menu principal')

  const mode = await askParsed(ask, 'Escolha o modo [1]: ', (raw) =>
    parseOperatorMode(raw.trim() || '1'),
  )

  if (mode === 'exit') return

  const maxUsers = await askParsed(
    ask,
    'Quantidade da fila (2 a 5) [2]: ',
    parseOperatorBatchSize,
  )

  const queue = context.pending.slice(0, maxUsers)

  console.log('\n[FILA]')
  console.log(`Checkpoint: ${checkpointProcessedCount(context.checkpoint)} participante(s) processado(s).`)
  console.log(
    `Fonte da fila: ${process.env.OPT_IN_FILE?.trim() ? `allowlist ${process.env.OPT_IN_FILE.trim()}` : 'telefones resolvidos do próprio Grupo A'}`,
  )
  console.log(`Pendentes elegíveis: ${context.pending.length}`)
  console.log(`Fila desta execução: ${queue.length}/${maxUsers}`)
  queue.forEach((participant, index) => printCandidate(index, participant))

  if (queue.length === 0) {
    console.log('\nNenhum participante elegível pendente. Nenhuma inclusão foi realizada.')
    return
  }

  if (mode === 'preview') {
    console.log('\n[PRÉVIA CONCLUÍDA]')
    console.log('Nenhum participante foi adicionado.')
    return
  }

  if (!context.destinationMembership) {
    throw new Error('A conta conectada precisa participar do Grupo B para executar um lote real.')
  }

  assertDestinationCanAttempt(context.destinationPermission, false)

  console.log('\n[AUTORIZAÇÃO]')
  if (!process.env.OPT_IN_FILE?.trim()) {
    console.log('ATENÇÃO: não há arquivo de opt-in configurado.')
    console.log('A fila foi extraída automaticamente do Grupo A usando apenas telefones resolvidos.')
  } else {
    console.log(`Allowlist ativa: ${process.env.OPT_IN_FILE.trim()}`)
  }
  console.log('Prossiga somente se as pessoas desta fila autorizaram a entrada no Grupo B.')

  const authorization = await ask('Digite AUTORIZADO para confirmar o consentimento desta fila: ')
  if (!hasAuthorizationConfirmation(authorization)) {
    console.log('Autorização não confirmada. Nenhuma inclusão foi realizada.')
    return
  }

  const delaySeconds = await askParsed(
    ask,
    'Intervalo entre tentativas em segundos (10 a 120) [15]: ',
    parseOperatorDelaySeconds,
  )

  console.log('\n[CONFIRMAÇÃO FINAL]')
  console.log(`${context.source.subject} → ${context.destination.subject}`)
  console.log(`Participantes nesta execução: ${queue.length}`)
  console.log(`Intervalo fixo: ${delaySeconds}s`)
  console.log('Checkpoint será salvo após cada resultado.')
  console.log('Operações de inclusão não possuem retry automático.')

  const finalConfirmation = await ask('Digite EXECUTAR para iniciar o lote real: ')
  if (!hasExecutionConfirmation(finalConfirmation)) {
    console.log('Execução cancelada. Nenhuma inclusão foi realizada.')
    return
  }

  let checkpointPath = ''
  const result = await executeControlledBatch(sock, context.destination.id, queue, {
    maxUsers,
    delayMs: delaySeconds * 1000,
    fetchDestination: () => getGroup(sock, context.destination.id),
    onResult: async (item) => {
      recordCheckpointResult(context.checkpoint, item)
      checkpointPath = await saveAutoCheckpoint(context.checkpoint)
    },
  })

  const batchReport = await writeBatchRunReport(context.source, context.destination, result)
  const pendingAfter = pendingAutomaticCandidates(
    context.analysis.candidates,
    context.checkpoint,
  ).length

  console.log('')
  for (const line of operatorDashboardLines(result, pendingAfter)) {
    console.log(line)
  }

  console.log(`Checkpoint: ${checkpointPath || 'sem alteração'}`)
  console.log(`Relatório JSON: ${batchReport.jsonPath}`)
  console.log(`Relatório CSV:  ${batchReport.csvPath}`)

  if (
    result.stoppedEarly ||
    result.results.some((item) => !['added', 'invite_required'].includes(item.status))
  ) {
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('O operador interativo precisa ser executado em um terminal interativo.')
  }

  console.log('========================================')
  console.log('      WHATSAPP-EXTRATOR — OPERADOR')
  console.log('========================================')
  console.log('Prévia é o modo padrão. Nenhuma inclusão ocorre sem confirmação explícita.')
  console.log('\nConectando ao WhatsApp...')

  const sock = await connectWhatsApp()
  const groups = await listGroups(sock)
  if (groups.length < 2) {
    throw new Error('São necessários pelo menos dois grupos disponíveis nesta conta.')
  }

  let state = await loadOperatorState()
  const rl = createInterface({ input, output })
  const ask = (question: string) => rl.question(question)

  try {
    while (true) {
      printMainMenu(state)
      const menu = await askParsed(ask, '\nEscolha uma opção: ', parseOperatorMainMenu)

      if (menu === 'exit') {
        console.log('Operador encerrado.')
        return
      }

      if (menu === 'history') {
        await showHistory()
        await ask('\nPressione ENTER para voltar ao menu...')
        continue
      }

      if (menu === 'new') {
        printGroups(groups)
        console.log('\n[SELEÇÃO DE GRUPOS]')
        const pair = await chooseGroupPair(groups, {}, ask)
        state = await saveLastPair({
          sourceJid: pair.source.id,
          destinationJid: pair.destination.id,
          sourceName: pair.source.name,
          destinationName: pair.destination.name,
        })
        await runPairOperation(sock, pair, ask)
        await ask('\nPressione ENTER para voltar ao menu...')
        continue
      }

      const pair = groupFromLastPair(groups, state.lastPair)
      if (!pair) {
        console.log('\nO último par não está disponível nesta conta. Use [1] Nova operação primeiro.')
        await ask('Pressione ENTER para voltar ao menu...')
        continue
      }

      if (menu === 'status') {
        console.log(`\nConsultando: ${pair.source.name} → ${pair.destination.name}`)
        const context = await loadPairContext(sock, pair)
        printQueueStatus(context)
        await ask('\nPressione ENTER para voltar ao menu...')
        continue
      }

      console.log(`\nContinuando: ${pair.source.name} → ${pair.destination.name}`)
      await runPairOperation(sock, pair, ask)
      await ask('\nPressione ENTER para voltar ao menu...')
    }
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error('\nErro:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
