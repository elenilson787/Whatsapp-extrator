import { connectWhatsApp } from './whatsapp.js'
import {
  analyzeMigration,
  findSelfParticipant,
  getGroup,
  isCurrentUserAdmin,
  listGroups,
} from './groups.js'
import { parseExcludedIdentities } from './identity.js'
import { executeSingleAdd, parseMaxUsers, selectPinnedCandidate } from './real-run.js'
import { writeDryRunReports, writeRealRunReport } from './report.js'

function previewLimit(): number {
  const parsed = Number(process.env.PREVIEW_LIMIT ?? '5')
  if (!Number.isFinite(parsed)) return 5
  return Math.min(50, Math.max(1, Math.floor(parsed)))
}

function knownPhoneCount(participants: Array<{ phoneNumber?: string | null }>): number {
  return participants.filter((participant) => Boolean(participant.phoneNumber)).length
}

async function main() {
  console.log('========================================')
  console.log('       WHATSAPP-EXTRATOR v0.3.2')
  console.log('========================================')
  console.log('Conectando ao WhatsApp...')

  const realRun = process.env.REAL_RUN === 'true'

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

  const sourceJid = process.env.SOURCE_GROUP_JID
  const destinationJid = process.env.DESTINATION_GROUP_JID

  if (!sourceJid && !destinationJid) {
    console.log('\nInforme SOURCE_GROUP_JID e DESTINATION_GROUP_JID para executar o DRY RUN.')
    console.log('Nenhum participante foi alterado.')
    return
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

  console.log(`\nConta no Grupo A: ${sourceIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
  console.log(`Conta no Grupo B: ${destinationIsAdmin ? 'ADMIN' : 'MEMBRO'}`)
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
  for (const [index, participant] of preview.entries()) {
    console.log(
      `${index + 1}. id=${participant.id} phone=${participant.phoneNumber ?? '-'} lid=${participant.lid ?? '-'}`,
    )
  }

  const dryRunReports = await writeDryRunReports(source, destination, analysis)
  console.log(`\nRelatório JSON: ${dryRunReports.jsonPath}`)
  console.log(`Relatório CSV:  ${dryRunReports.csvPath}`)

  if (!realRun) {
    console.log('\nNenhum participante foi adicionado. REAL_RUN=false.')
    return
  }

  parseMaxUsers(process.env.MAX_USERS)

  if (!destinationMembership) {
    throw new Error('A conta conectada precisa ser participante do Grupo B para o teste real.')
  }

  if (!destinationIsAdmin) {
    if (process.env.ALLOW_NON_ADMIN_DESTINATION !== 'true') {
      throw new Error(
        'Grupo B está em modo MEMBRO. Para testar a permissão do próprio WhatsApp, defina ALLOW_NON_ADMIN_DESTINATION=true. A ferramenta não contorna restrições do grupo.',
      )
    }

    console.log('\n[AVISO] Grupo B: conta não é admin.')
    console.log('A tentativa será feita uma única vez e o próprio WhatsApp decidirá se membros podem adicionar participantes.')
    console.log('Se o servidor negar a operação, não haverá retry nem tentativa de contorno.')
  }

  if (analysis.candidates.length === 0) {
    throw new Error('Não há candidato válido para o teste real.')
  }

  const candidate = selectPinnedCandidate(
    analysis.candidates,
    process.env.TARGET_PARTICIPANT,
  )

  console.log('\n[REAL RUN CONTROLADO — 1 PARTICIPANTE]')
  console.log(
    `Alvo fixado: id=${candidate.id} phone=${candidate.phoneNumber ?? '-'} lid=${candidate.lid ?? '-'}`,
  )
  console.log('Limite rígido: MAX_USERS=1')
  console.log('Nenhuma segunda pessoa será processada nesta execução.')

  const result = await executeSingleAdd(sock, destination.id, candidate)
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
