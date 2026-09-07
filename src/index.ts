import { connectWhatsApp } from './whatsapp.js'
import {
  analyzeMigration,
  findSelfParticipant,
  getGroup,
  isCurrentUserAdmin,
  listGroups,
  resolveTargetPhone,
} from './groups.js'
import type { ParticipantRecord, ResolvedPhoneIdentity } from './groups.js'
import { parseExcludedIdentities } from './identity.js'
import {
  executeSingleAdd,
  parseMaxUsers,
  participantRequestJid,
  selectPinnedCandidate,
} from './real-run.js'
import { writeDryRunReports, writeRealRunReport } from './report.js'
import { diagnoseTarget, targetDiagnosisMessage } from './target-diagnosis.js'
import {
  assertDestinationCanAttempt,
  destinationAddPermission,
  destinationAddPermissionLabel,
} from './destination-permission.js'
import {
  executeControlledBatch,
  parseBatchDelayMs,
  parseBatchMaxUsers,
  parseTargetPhones,
  selectPinnedCandidates,
} from './batch-run.js'
import { writeBatchRunReport } from './batch-report.js'
import {
  loadAutoCheckpoint,
  recordCheckpointResult,
  saveAutoCheckpoint,
  selectAutomaticCandidates,
} from './auto-batch.js'
import type { AutoCheckpoint } from './auto-batch.js'
import { selectGroupPairInteractively } from './group-selection.js'

function previewLimit(): number {
  const parsed = Number(process.env.PREVIEW_LIMIT ?? '5')
  if (!Number.isFinite(parsed)) return 5
  return Math.min(50, Math.max(1, Math.floor(parsed)))
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

async function main() {
  console.log('========================================')
  console.log('       WHATSAPP-EXTRATOR v0.6.0')
  console.log('========================================')
  console.log('Conectando ao WhatsApp...')

  const interactiveGroupSelection = process.argv.includes('--select-groups')
  const realRun = !interactiveGroupSelection && process.env.REAL_RUN === 'true'
  const batchRun = !interactiveGroupSelection && process.env.BATCH_RUN === 'true'
  const autoBatch = !interactiveGroupSelection && process.env.AUTO_BATCH === 'true'

  if (batchRun && autoBatch) {
    throw new Error('Use BATCH_RUN ou AUTO_BATCH, nunca os dois ao mesmo tempo.')
  }

  const sock = await connectWhatsApp()
  const groups = await listGroups(sock)

  console.log(`\nGrupos encontrados: ${groups.length}\n`)

  if (groups.length === 0) {
    console.log('Nenhum grupo encontrado nesta conta.')
    return
  }

  for (const [index, group] of groups.entries()) {
    console.log(
      `${index + 1}. ${group.name} | ${group.size} participantes | ${group.isAdmin ? 'ADMIN' : 'MEMBRO'}`,
    )
    console.log(`   JID: ${group.id}`)
  }

  let sourceJid = process.env.SOURCE_GROUP_JID?.trim()
  let destinationJid = process.env.DESTINATION_GROUP_JID?.trim()

  if (interactiveGroupSelection || !sourceJid || !destinationJid) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('\nInforme SOURCE_GROUP_JID e DESTINATION_GROUP_JID para executar o DRY RUN.')
      console.log('Em terminal interativo, use npm run dev -- --select-groups para escolher pela lista.')
      console.log('Nenhum participante foi alterado.')
      return
    }

    console.log('\n[SELEÇÃO INTERATIVA DE GRUPOS]')
    console.log('Escolha pelos números exibidos na lista acima.')

    const selectedPair = await selectGroupPairInteractively(
      groups,
      interactiveGroupSelection ? {} : { sourceJid, destinationJid },
    )

    sourceJid = selectedPair.source.id
    destinationJid = selectedPair.destination.id

    console.log('\nSeleção confirmada:')
    console.log(`SOURCE_GROUP_JID=${sourceJid}`)
    console.log(`DESTINATION_GROUP_JID=${destinationJid}`)

    if (interactiveGroupSelection) {
      console.log('\nModo --select-groups é sempre DRY RUN: REAL_RUN/BATCH_RUN/AUTO_BATCH foram ignorados nesta execução.')
      console.log('Para reutilizar esta seleção no PowerShell:')
      console.log(`$env:SOURCE_GROUP_JID="${sourceJid}"`)
      console.log(`$env:DESTINATION_GROUP_JID="${destinationJid}"`)
    }
  }

  if (!sourceJid || !destinationJid) {
    throw new Error('SOURCE_GROUP_JID e DESTINATION_GROUP_JID devem ser informados juntos.')
  }

  const [source, destination] = await Promise.all([
    getGroup(sock, sourceJid),
    getGroup(sock, destinationJid),
  ])

  const account = sock.user as { id?: string; lid?: string } | undefined
  const selfJids = [account?.id, account?.lid].filter(
    (value): value is string => Boolean(value),
  )

  const sourceIsAdmin = isCurrentUserAdmin(source, selfJids)
  const destinationIsAdmin = isCurrentUserAdmin(destination, selfJids)
  const destinationMembership = findSelfParticipant(destination, selfJids)
  const destinationPermission = destinationAddPermission(destination, destinationIsAdmin)

  console.log(`\nConta no Grupo A: ${sourceIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
  console.log(`Conta no Grupo B: ${destinationIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
  console.log(`Permissão de inclusão no Grupo B: ${destinationAddPermissionLabel(destinationPermission)}`)
  console.log(
    `PN conhecido na origem: ${knownPhoneCount(source.participants)}/${source.participants.length}`,
  )
  console.log(
    `PN conhecido no destino: ${knownPhoneCount(destination.participants)}/${destination.participants.length}`,
  )

  const excludedJids = parseExcludedIdentities(process.env.EXCLUDED_JIDS)
  const analysis = analyzeMigration(source, destination, { selfJids, excludedJids })

  console.log('\n[DRY RUN VALIDADO]')
  console.log(`${source.subject} → ${destination.subject}`)
  console.log(`Origem: ${analysis.sourceTotal}`)
  console.log(`Destino: ${analysis.destinationTotal}`)
  console.log(`Admins/owner ignorados: ${analysis.adminOrOwnerSkipped.length}`)
  console.log(`Própria conta ignorada: ${analysis.selfSkipped.length}`)
  console.log(`Exclusões manuais: ${analysis.manuallyExcluded.length}`)
  console.log(`Já no destino: ${analysis.alreadyInDestination.length}`)
  console.log(`Duplicados na origem: ${analysis.duplicateSourceSkipped.length}`)
  console.log(`Candidatos finais: ${analysis.candidates.length}`)

  const limit = previewLimit()
  const preview = analysis.candidates.slice(0, limit)

  console.log(`\nPrimeiros ${preview.length} candidato(s):`)
  preview.forEach((participant, index) => printCandidate(index, participant))

  const targetPhoneRaw = interactiveGroupSelection ? undefined : process.env.TARGET_PHONE?.trim()
  const targetParticipantRaw = interactiveGroupSelection ? undefined : process.env.TARGET_PARTICIPANT?.trim()
  const targetPhonesRaw = interactiveGroupSelection ? undefined : process.env.TARGET_PHONES?.trim()

  const configuredTargetModes = [targetPhoneRaw, targetParticipantRaw, targetPhonesRaw].filter(Boolean)
  if (configuredTargetModes.length > 1) {
    throw new Error('Use apenas um modo de alvo: TARGET_PHONE, TARGET_PARTICIPANT ou TARGET_PHONES.')
  }

  if (autoBatch && configuredTargetModes.length > 0) {
    throw new Error('AUTO_BATCH seleciona a fila automaticamente. Remova TARGET_PHONE, TARGET_PARTICIPANT e TARGET_PHONES.')
  }

  let resolvedTarget: ResolvedPhoneIdentity | undefined
  if (targetPhoneRaw) {
    resolvedTarget = await resolveTargetPhone(sock, targetPhoneRaw)
    const diagnosis = diagnoseTarget(analysis, resolvedTarget)

    console.log('\n[ALVO DIRECIONADO]')
    console.log(`phone=${resolvedTarget.phoneNumber}`)
    console.log(`lid=${resolvedTarget.lid ?? 'não resolvido pela sessão'}`)
    console.log(`Candidato válido atual: ${diagnosis.code === 'candidate' ? 'SIM' : 'NÃO'}`)
    console.log(`Motivo: ${targetDiagnosisMessage(diagnosis.code)}`)

    if (diagnosis.participant) {
      const match = diagnosis.participant
      console.log(
        `Correspondência: id=${match.id} phone=${match.phoneNumber ?? '-'} lid=${match.lid ?? '-'}`,
      )
    }
  }

  let resolvedBatchTargets: ResolvedPhoneIdentity[] | undefined
  if (targetPhonesRaw) {
    const phones = parseTargetPhones(targetPhonesRaw)
    resolvedBatchTargets = []

    console.log('\n[LOTE DIRECIONADO — PRÉ-VALIDAÇÃO]')
    for (const [index, phone] of phones.entries()) {
      const resolved = await resolveTargetPhone(sock, phone)
      const diagnosis = diagnoseTarget(analysis, resolved)
      resolvedBatchTargets.push(resolved)
      console.log(
        `${index + 1}. phone=${resolved.phoneNumber} lid=${resolved.lid ?? '-'} válido=${diagnosis.code === 'candidate' ? 'SIM' : 'NÃO'} — ${targetDiagnosisMessage(diagnosis.code)}`,
      )
    }
  }

  let autoCheckpoint: AutoCheckpoint | undefined
  let automaticCandidates: ParticipantRecord[] | undefined
  let autoMaxUsers: number | undefined

  if (autoBatch) {
    autoMaxUsers = parseBatchMaxUsers(process.env.MAX_USERS)
    autoCheckpoint = await loadAutoCheckpoint(source.id, destination.id)
    automaticCandidates = selectAutomaticCandidates(
      analysis.candidates,
      autoCheckpoint,
      autoMaxUsers,
    )

    console.log('\n[AUTO_BATCH — PRÉVIA DA PRÓXIMA FILA]')
    console.log(`Checkpoint: ${checkpointProcessedCount(autoCheckpoint)} participante(s) já processado(s) neste par de grupos.`)
    console.log(`Próximos candidatos automáticos: ${automaticCandidates.length}/${autoMaxUsers}`)
    automaticCandidates.forEach((participant, index) => printCandidate(index, participant))
    if (automaticCandidates.length === 0) {
      console.log('Nenhum candidato pendente no checkpoint atual.')
    }
  }

  const dryRunReports = await writeDryRunReports(source, destination, analysis)
  console.log(`\nRelatório JSON: ${dryRunReports.jsonPath}`)
  console.log(`Relatório CSV:  ${dryRunReports.csvPath}`)

  if (!realRun) {
    console.log('\nNenhum participante foi adicionado. REAL_RUN=false.')
    return
  }

  if (!destinationMembership) {
    throw new Error('A conta conectada precisa ser participante do Grupo B para o teste real.')
  }

  assertDestinationCanAttempt(
    destinationPermission,
    process.env.ALLOW_NON_ADMIN_DESTINATION === 'true',
  )

  if (!destinationIsAdmin && destinationPermission === 'unknown') {
    console.log('\n[AVISO] memberAddMode não foi informado pelo WhatsApp.')
    console.log('A tentativa controlada foi explicitamente autorizada por ALLOW_NON_ADMIN_DESTINATION=true.')
  }

  if (analysis.candidates.length === 0) {
    throw new Error('Não há candidato válido para o teste real.')
  }

  if (autoBatch) {
    if (process.env.OPT_IN_SOURCE_CONFIRMED !== 'true') {
      throw new Error(
        'AUTO_BATCH real exige OPT_IN_SOURCE_CONFIRMED=true. Use esse modo somente quando o Grupo A contiver participantes que autorizaram a migração.',
      )
    }

    if (!autoCheckpoint || !automaticCandidates || !autoMaxUsers) {
      throw new Error('Falha interna ao preparar a fila automática.')
    }

    if (automaticCandidates.length === 0) {
      console.log('\n[AUTO_BATCH] Nenhum candidato pendente. Nenhuma chamada de inclusão foi enviada.')
      return
    }

    const delayMs = parseBatchDelayMs(process.env.BATCH_DELAY_MS)
    console.log(`\n[AUTO_BATCH CONTROLADO — ${automaticCandidates.length} PARTICIPANTE(S)]`)
    console.log(`Limite rígido: MAX_USERS=${autoMaxUsers}`)
    console.log(`Intervalo fixo de segurança: ${delayMs} ms entre tentativas.`)
    console.log('A seleção é automática entre os candidatos elegíveis ainda não processados.')
    console.log('O checkpoint é salvo após cada resultado para impedir repetição automática.')
    console.log('Não há aleatorização nem mecanismo para contornar controles do WhatsApp.')

    let checkpointPath = ''
    const batchResult = await executeControlledBatch(
      sock,
      destination.id,
      automaticCandidates,
      {
        maxUsers: autoMaxUsers,
        delayMs,
        fetchDestination: () => getGroup(sock, destination.id),
        onResult: async (result) => {
          recordCheckpointResult(autoCheckpoint!, result)
          checkpointPath = await saveAutoCheckpoint(autoCheckpoint!)
        },
      },
    )
    const batchReport = await writeBatchRunReport(source, destination, batchResult)

    console.log('\nResultados do AUTO_BATCH:')
    for (const [index, result] of batchResult.results.entries()) {
      console.log(
        `${index + 1}. ${result.requestJid} → ${result.status} | API=${result.apiStatus} | confirmado=${result.confirmed ? 'SIM' : 'NÃO'}`,
      )
    }
    if (batchResult.stopReason) console.log(`Parada segura: ${batchResult.stopReason}`)
    console.log(`Tentados: ${batchResult.attempted}/${batchResult.requested}`)
    console.log(`Checkpoint: ${checkpointPath || 'sem alteração'}`)
    console.log(`Relatório do lote: ${batchReport.jsonPath}`)
    console.log(`CSV do lote:       ${batchReport.csvPath}`)

    if (
      batchResult.stoppedEarly ||
      batchResult.results.some(
        (item) => !['added', 'invite_required'].includes(item.status),
      )
    ) {
      process.exitCode = 1
    }
    return
  }

  if (batchRun) {
    if (!resolvedBatchTargets) {
      throw new Error('BATCH_RUN=true exige TARGET_PHONES com os números previamente autorizados.')
    }

    const maxUsers = parseBatchMaxUsers(process.env.MAX_USERS)
    const selected = selectPinnedCandidates(analysis.candidates, resolvedBatchTargets, maxUsers)
    const candidates = selected.map((candidate, index) => ({
      ...candidate,
      phoneNumber: resolvedBatchTargets![index].phoneNumber,
      lid: resolvedBatchTargets![index].lid ?? candidate.lid,
    }))

    console.log(`\n[REAL RUN CONTROLADO — LOTE DE ${candidates.length}]`)
    console.log(`Limite rígido: MAX_USERS=${maxUsers}`)
    console.log('Somente os números explicitamente informados em TARGET_PHONES serão processados.')
    console.log('O lote para automaticamente em erro de permissão, rejeição inesperada ou falha de confirmação.')

    const batchResult = await executeControlledBatch(sock, destination.id, candidates, {
      maxUsers,
      delayMs: Number(process.env.BATCH_DELAY_MS ?? '15000'),
      fetchDestination: () => getGroup(sock, destination.id),
    })
    const batchReport = await writeBatchRunReport(source, destination, batchResult)

    console.log('\nResultados do lote:')
    for (const [index, result] of batchResult.results.entries()) {
      console.log(
        `${index + 1}. ${result.requestJid} → ${result.status} | API=${result.apiStatus} | confirmado=${result.confirmed ? 'SIM' : 'NÃO'}`,
      )
    }
    if (batchResult.stopReason) console.log(`Parada segura: ${batchResult.stopReason}`)
    console.log(`Tentados: ${batchResult.attempted}/${batchResult.requested}`)
    console.log(`Relatório do lote: ${batchReport.jsonPath}`)
    console.log(`CSV do lote:       ${batchReport.csvPath}`)

    if (
      batchResult.stoppedEarly ||
      batchResult.results.some(
        (item) => !['added', 'invite_required'].includes(item.status),
      )
    ) {
      process.exitCode = 1
    }
    return
  }

  parseMaxUsers(process.env.MAX_USERS)

  const selected = selectPinnedCandidate(
    analysis.candidates,
    resolvedTarget ?? targetParticipantRaw,
  )

  const candidate = resolvedTarget
    ? {
        ...selected,
        phoneNumber: resolvedTarget.phoneNumber,
        lid: resolvedTarget.lid ?? selected.lid,
      }
    : selected

  console.log('\n[REAL RUN CONTROLADO — 1 PARTICIPANTE]')
  console.log(
    `Alvo fixado: id=${candidate.id} phone=${candidate.phoneNumber ?? '-'} lid=${candidate.lid ?? '-'}`,
  )
  console.log('Limite rígido: MAX_USERS=1')
  console.log('Nenhuma segunda pessoa será processada nesta execução.')

  const result = await executeSingleAdd(sock, destination.id, candidate, {
    fetchDestination: () => getGroup(sock, destination.id),
  })
  const realRunReport = await writeRealRunReport(source, destination, result)

  console.log(`\nStatus da API do WhatsApp: ${result.apiStatus}`)
  console.log(`Confirmação no Grupo B: ${result.confirmed ? 'SIM' : 'NÃO'}`)
  console.log(`Resultado final: ${result.status}`)
  if (result.error) {
    console.log(`Detalhe: ${result.error}`)
  }
  console.log(`Relatório do teste real: ${realRunReport.jsonPath}`)
  console.log(`CSV do teste real:       ${realRunReport.csvPath}`)

  if (result.status !== 'added') {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('\nErro:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
