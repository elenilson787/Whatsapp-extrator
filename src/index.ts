import { connectWhatsApp } from './whatsapp.js'
import {
  analyzeMigration,
  getGroup,
  isCurrentUserAdmin,
  listGroups,
} from './groups.js'
import { parseExcludedIdentities } from './identity.js'
import { writeDryRunReports } from './report.js'

function previewLimit(): number {
  const parsed = Number(process.env.PREVIEW_LIMIT ?? '5')
  if (!Number.isFinite(parsed)) return 5
  return Math.min(50, Math.max(1, Math.floor(parsed)))
}

async function main() {
  console.log('========================================')
  console.log('       WHATSAPP-EXTRATOR v0.2.0')
  console.log('========================================')
  console.log('Conectando ao WhatsApp...')

  if (process.env.REAL_RUN === 'true') {
    throw new Error(
      'REAL_RUN ainda não é suportado. Esta versão executa somente DRY RUN e não adiciona participantes.',
    )
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

  if (!isCurrentUserAdmin(source, selfJids)) {
    throw new Error('A conta conectada precisa ser administradora do Grupo A para esta migração.')
  }

  if (!isCurrentUserAdmin(destination, selfJids)) {
    throw new Error('A conta conectada precisa ser administradora do Grupo B para esta migração.')
  }

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

  const reports = await writeDryRunReports(source, destination, analysis)
  console.log(`\nRelatório JSON: ${reports.jsonPath}`)
  console.log(`Relatório CSV:  ${reports.csvPath}`)
  console.log('\nNenhum participante foi adicionado. Esta versão permanece somente DRY RUN.')
}

main().catch((error) => {
  console.error('\nErro:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
