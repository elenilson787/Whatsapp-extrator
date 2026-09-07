import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { connectWhatsApp } from './whatsapp.js'
import {
  analyzeMigration,
  findSelfParticipant,
  getGroup,
  isCurrentUserAdmin,
  listGroups,
} from './groups.js'
import type { ParticipantRecord } from './groups.js'
import { chooseGroupPair } from './group-selection.js'
import {
  assertDestinationCanAttempt,
  destinationAddPermission,
  destinationAddPermissionLabel,
} from './destination-permission.js'
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
  parseOperatorMode,
} from './operator-utils.js'

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
  ask: (question: string) => Promise<string>,
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

  console.log(`\nGrupos encontrados: ${groups.length}\n`)
  for (const [index, group] of groups.entries()) {
    console.log(
      `${index + 1}. ${group.name} | ${group.size} participantes | ${group.isAdmin ? 'ADMIN' : 'MEMBRO'}`,
    )
    console.log(`   JID: ${group.id}`)
  }

  const rl = createInterface({ input, output })
  const ask = (question: string) => rl.question(question)

  try {
    console.log('\n[1/6 — GRUPOS]')
    const pair = await chooseGroupPair(groups, {}, ask)

    console.log('\nCarregando metadados dos grupos...')
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

    console.log('\n[2/6 — ANÁLISE]')
    console.log(`${source.subject} → ${destination.subject}`)
    console.log(`Conta no Grupo A: ${sourceIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
    console.log(`Conta no Grupo B: ${destinationIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
    console.log(`Permissão no Grupo B: ${destinationAddPermissionLabel(destinationPermission)}`)
    console.log(`Origem: ${analysis.sourceTotal}`)
    console.log(`Destino: ${analysis.destinationTotal}`)
    console.log(`PN conhecido na origem: ${knownPhoneCount(source.participants)}/${source.participants.length}`)
    console.log(`Admins/owner ignorados: ${analysis.adminOrOwnerSkipped.length}`)
    console.log(`Própria conta ignorada: ${analysis.selfSkipped.length}`)
    console.log(`Já no destino: ${analysis.alreadyInDestination.length}`)
    console.log(`Candidatos finais: ${analysis.candidates.length}`)

    const dryReport = await writeDryRunReports(source, destination, analysis)
    console.log(`Relatório DRY JSON: ${dryReport.jsonPath}`)

    console.log('\n[3/6 — MODO]')
    console.log('1. Apenas prévia segura')
    console.log('2. Lote autorizado')
    console.log('3. Sair')

    const mode = await askParsed(ask, 'Escolha o modo [1]: ', (raw) =>
      parseOperatorMode(raw.trim() || '1'),
    )

    if (mode === 'exit') {
      console.log('Operação encerrada. Nenhuma inclusão foi realizada.')
      return
    }

    const maxUsers = await askParsed(
      ask,
      'Quantidade da fila (2 a 5) [2]: ',
      parseOperatorBatchSize,
    )

    const checkpoint = await loadAutoCheckpoint(source.id, destination.id)
    const pendingBefore = pendingAutomaticCandidates(analysis.candidates, checkpoint)
    const queue = pendingBefore.slice(0, maxUsers)

    console.log('\n[4/6 — FILA]')
    console.log(`Checkpoint: ${checkpointProcessedCount(checkpoint)} participante(s) processado(s).`)
    console.log(
      `Fonte da fila: ${process.env.OPT_IN_FILE?.trim() ? `allowlist ${process.env.OPT_IN_FILE.trim()}` : 'telefones resolvidos do próprio Grupo A'}`,
    )
    console.log(`Pendentes elegíveis: ${pendingBefore.length}`)
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

    if (!destinationMembership) {
      throw new Error('A conta conectada precisa participar do Grupo B para executar um lote real.')
    }

    // O operador não usa override silencioso para permissão desconhecida.
    assertDestinationCanAttempt(destinationPermission, false)

    console.log('\n[5/6 — AUTORIZAÇÃO]')
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

    console.log('\n[6/6 — CONFIRMAÇÃO FINAL]')
    console.log(`${source.subject} → ${destination.subject}`)
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
    const result = await executeControlledBatch(sock, destination.id, queue, {
      maxUsers,
      delayMs: delaySeconds * 1000,
      fetchDestination: () => getGroup(sock, destination.id),
      onResult: async (item) => {
        recordCheckpointResult(checkpoint, item)
        checkpointPath = await saveAutoCheckpoint(checkpoint)
      },
    })

    const batchReport = await writeBatchRunReport(source, destination, result)
    const pendingAfter = pendingAutomaticCandidates(analysis.candidates, checkpoint).length

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
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error('\nErro:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
