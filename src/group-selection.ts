import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { GroupSummary } from './groups.js'

export type SelectedGroupPair = {
  source: GroupSummary
  destination: GroupSummary
}

type Ask = (question: string) => Promise<string>

type PresetSelection = {
  sourceJid?: string
  destinationJid?: string
}

function groupByJid(groups: GroupSummary[], jid?: string): GroupSummary | undefined {
  const normalized = jid?.trim()
  if (!normalized) return undefined
  return groups.find((group) => group.id === normalized)
}

export function parseGroupChoice(raw: string, groups: GroupSummary[]): GroupSummary {
  const parsed = Number(raw.trim())
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > groups.length) {
    throw new Error(`Escolha inválida. Digite um número entre 1 e ${groups.length}.`)
  }
  return groups[parsed - 1]
}

async function askForGroup(
  ask: Ask,
  label: string,
  groups: GroupSummary[],
  disallowId?: string,
): Promise<GroupSummary> {
  while (true) {
    const raw = await ask(`Escolha o ${label}: `)
    try {
      const selected = parseGroupChoice(raw, groups)
      if (selected.id === disallowId) {
        console.log('Grupo A e Grupo B precisam ser diferentes. Escolha outro grupo.')
        continue
      }
      return selected
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function chooseGroupPair(
  groups: GroupSummary[],
  preset: PresetSelection,
  ask: Ask,
): Promise<SelectedGroupPair> {
  if (groups.length < 2) {
    throw new Error('São necessários pelo menos dois grupos para escolher origem e destino.')
  }

  const presetSource = groupByJid(groups, preset.sourceJid)
  const presetDestination = groupByJid(groups, preset.destinationJid)

  if (preset.sourceJid && !presetSource) {
    throw new Error('SOURCE_GROUP_JID não corresponde a nenhum grupo disponível nesta conta.')
  }
  if (preset.destinationJid && !presetDestination) {
    throw new Error('DESTINATION_GROUP_JID não corresponde a nenhum grupo disponível nesta conta.')
  }
  if (presetSource && presetDestination && presetSource.id === presetDestination.id) {
    throw new Error('Grupo A e Grupo B precisam ser diferentes.')
  }

  while (true) {
    const source = presetSource ?? await askForGroup(ask, 'GRUPO A (origem)', groups)
    const destination = presetDestination ?? await askForGroup(
      ask,
      'GRUPO B (destino)',
      groups,
      source.id,
    )

    if (source.id === destination.id) {
      console.log('Grupo A e Grupo B precisam ser diferentes.')
      if (presetSource || presetDestination) {
        throw new Error('As seleções predefinidas apontam para o mesmo grupo.')
      }
      continue
    }

    console.log('\n[CONFIRMAÇÃO DOS GRUPOS]')
    console.log(`Grupo A (origem): ${source.name} | ${source.size} participantes | ${source.isAdmin ? 'ADMIN' : 'MEMBRO'}`)
    console.log(`Grupo B (destino): ${destination.name} | ${destination.size} participantes | ${destination.isAdmin ? 'ADMIN' : 'MEMBRO'}`)

    const confirmation = (await ask('Confirmar estes grupos? [S/N]: ')).trim().toLowerCase()
    if (['s', 'sim', 'y', 'yes'].includes(confirmation)) {
      return { source, destination }
    }

    if (presetSource || presetDestination) {
      throw new Error('Seleção de grupos cancelada pelo usuário.')
    }

    console.log('\nSeleção cancelada. Escolha novamente.\n')
  }
}

export async function selectGroupPairInteractively(
  groups: GroupSummary[],
  preset: PresetSelection = {},
): Promise<SelectedGroupPair> {
  const rl = createInterface({ input, output })
  try {
    return await chooseGroupPair(groups, preset, (question) => rl.question(question))
  } finally {
    rl.close()
  }
}
