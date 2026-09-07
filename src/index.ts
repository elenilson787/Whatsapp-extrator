import { connectWhatsApp } from './whatsapp.js'
import { listGroups, getGroup, participantsNotInDestination } from './groups.js'

async function main() {
  console.log('========================================')
  console.log('       WHATSAPP-EXTRATOR v0.1.0')
  console.log('========================================')
  console.log('Conectando ao WhatsApp...')

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

  console.log('\nPróxima etapa: seleção do Grupo A e Grupo B + modo DRY RUN.')
  console.log('Nenhum participante foi alterado nesta versão.')

  // Smoke test opcional: o processo pode receber os JIDs por variáveis de ambiente.
  const sourceJid = process.env.SOURCE_GROUP_JID
  const destinationJid = process.env.DESTINATION_GROUP_JID

  if (sourceJid && destinationJid) {
    const [source, destination] = await Promise.all([
      getGroup(sock, sourceJid),
      getGroup(sock, destinationJid),
    ])

    const pending = participantsNotInDestination(source, destination)

    console.log('\n[DRY RUN]')
    console.log(`${source.subject} → ${destination.subject}`)
    console.log(`Origem: ${source.participants.length}`)
    console.log(`Já no destino: ${source.participants.length - pending.length}`)
    console.log(`Seriam processados: ${pending.length}`)
    console.log('Nenhum participante foi adicionado.')
  }
}

main().catch((error) => {
  console.error('\nErro:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
