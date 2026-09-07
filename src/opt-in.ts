import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { ParticipantRecord } from './groups.js'
import { normalizeInputJid } from './identity.js'

const DEFAULT_PHONE_HEADERS = new Set([
  'telefone',
  'telefonedowhatsapp',
  'telefonewhatsapp',
  'whatsapp',
  'celular',
  'phone',
  'phonenumber',
  'numero',
  'numerodetelefone',
  'numerowhatsapp',
  'contatowhatsapp',
])

function canonicalHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function delimiterCount(line: string, delimiter: ',' | ';'): number {
  let quoted = false
  let count = 0

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (!quoted && char === delimiter) {
      count += 1
    }
  }

  return count
}

function detectDelimiter(line: string): ',' | ';' {
  return delimiterCount(line, ';') > delimiterCount(line, ',') ? ';' : ','
}

function parseDelimitedLine(line: string, delimiter: ',' | ';'): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (!quoted && char === delimiter) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

export function normalizeOptInPhone(raw: string): string | undefined {
  let digits = raw.replace(/\D/g, '')

  // Exportações brasileiras de formulário frequentemente trazem apenas DDD+número.
  // Nesses casos, adicionamos o DDI 55. Números já internacionais são preservados.
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`
  }

  if (digits.length < 12 || digits.length > 15) return undefined
  return normalizeInputJid(digits)
}

function uniqueValidPhones(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map(normalizeOptInPhone)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
}

export function parseOptInText(content: string): string[] {
  return uniqueValidPhones(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

export function parseOptInCsv(
  content: string,
  explicitPhoneColumn?: string,
): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error('Arquivo de opt-in está vazio.')
  }

  const delimiter = detectDelimiter(lines[0])
  const header = parseDelimitedLine(lines[0], delimiter)
  const canonicalHeaders = header.map(canonicalHeader)
  const explicit = explicitPhoneColumn ? canonicalHeader(explicitPhoneColumn) : undefined

  let phoneIndex = explicit
    ? canonicalHeaders.findIndex((value) => value === explicit)
    : canonicalHeaders.findIndex((value) => DEFAULT_PHONE_HEADERS.has(value))

  let dataStart = 1

  // CSV/TXT de uma única coluna sem cabeçalho reconhecido: tratamos todas as linhas como números.
  if (phoneIndex < 0 && header.length === 1) {
    const firstPhone = normalizeOptInPhone(header[0])
    if (firstPhone) {
      phoneIndex = 0
      dataStart = 0
    }
  }

  if (phoneIndex < 0) {
    const available = header.join(', ')
    throw new Error(
      explicit
        ? `Coluna de telefone "${explicitPhoneColumn}" não encontrada no CSV. Colunas disponíveis: ${available}`
        : `Não encontrei uma coluna de telefone/WhatsApp no CSV. Colunas disponíveis: ${available}. Use OPT_IN_PHONE_COLUMN se necessário.`,
    )
  }

  const values: string[] = []
  for (let index = dataStart; index < lines.length; index += 1) {
    const row = parseDelimitedLine(lines[index], delimiter)
    values.push(row[phoneIndex] ?? '')
  }

  const phones = uniqueValidPhones(values)
  if (phones.length === 0) {
    throw new Error('Nenhum telefone válido foi encontrado no arquivo de opt-in.')
  }

  return phones
}

export function loadOptInPhones(
  filePath: string,
  explicitPhoneColumn?: string,
): string[] {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Não foi possível ler OPT_IN_FILE=${filePath}: ${message}`)
  }

  const extension = extname(filePath).toLowerCase()
  const phones = extension === '.txt'
    ? parseOptInText(content)
    : parseOptInCsv(content, explicitPhoneColumn)

  if (phones.length === 0) {
    throw new Error('A lista de opt-in não contém telefones válidos.')
  }

  return phones
}

export function loadOptInPhonesFromEnv(): string[] {
  const filePath = process.env.OPT_IN_FILE?.trim()
  if (!filePath) {
    throw new Error(
      'AUTO_BATCH exige OPT_IN_FILE apontando para um CSV/TXT com os telefones que autorizaram a entrada no Grupo B.',
    )
  }

  return loadOptInPhones(filePath, process.env.OPT_IN_PHONE_COLUMN?.trim())
}

export function filterCandidatesByOptIn(
  candidates: ParticipantRecord[],
  allowedPhones: string[],
): ParticipantRecord[] {
  const allowed = new Set(allowedPhones.map(normalizeInputJid))

  return candidates.filter((candidate) => {
    if (!candidate.phoneNumber) return false
    return allowed.has(normalizeInputJid(candidate.phoneNumber))
  })
}
