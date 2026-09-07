import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import type { WASocket } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { pino } from 'pino'
import qrcode from 'qrcode-terminal'
import { mkdir } from 'node:fs/promises'

export type ConnectedClient = WASocket
export type DisconnectAction = 'restart' | 'logged-out' | 'fatal'

const AUTH_DIR = 'data/auth'
const MAX_RESTARTS = 3
const READ_RECONNECT_ATTEMPTS = 1

export function classifyDisconnect(code?: number): DisconnectAction {
  if (code === DisconnectReason.restartRequired) return 'restart'
  if (code === DisconnectReason.loggedOut) return 'logged-out'
  return 'fatal'
}

export function isTransientReadError(error: unknown): boolean {
  const boomCode = error instanceof Boom ? error.output?.statusCode : undefined
  if ([408, 428, 503, 515].includes(boomCode ?? -1)) return true

  const message = error instanceof Error ? error.message : String(error)
  return /connection closed|connection lost|timed out|timeout|econnreset|socket hang up|stream errored/i.test(
    message,
  )
}

async function connectAttempt(): Promise<
  | { kind: 'open'; sock: WASocket }
  | { kind: 'restart' }
> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  return await new Promise((resolve, reject) => {
    let settled = false

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\nEscaneie este QR Code no WhatsApp > Dispositivos conectados:\n')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open' && !settled) {
        settled = true
        resolve({ kind: 'open', sock })
        return
      }

      if (connection === 'close' && !settled) {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const action = classifyDisconnect(code)
        settled = true

        if (action === 'restart') {
          resolve({ kind: 'restart' })
          return
        }

        if (action === 'logged-out') {
          reject(
            new Error(
              'A sessão foi encerrada no WhatsApp. Remova data/auth e conecte novamente.',
            ),
          )
          return
        }

        reject(
          new Error(`Não foi possível conectar ao WhatsApp. Código: ${code ?? 'desconhecido'}`),
        )
      }
    })
  })
}

async function connectRawWhatsApp(): Promise<WASocket> {
  await mkdir('data', { recursive: true })

  for (let restart = 0; restart <= MAX_RESTARTS; restart += 1) {
    const result = await connectAttempt()

    if (result.kind === 'open') {
      return result.sock
    }

    if (restart < MAX_RESTARTS) {
      console.log('\nWhatsApp solicitou reinício da conexão (515). Reconectando automaticamente...')
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }

  throw new Error(
    `O WhatsApp solicitou reinício mais de ${MAX_RESTARTS} vezes. Tente conectar novamente.`,
  )
}

export async function connectWhatsApp(): Promise<ConnectedClient> {
  let active = await connectRawWhatsApp()
  let reconnecting: Promise<WASocket> | undefined

  const reconnect = async (): Promise<WASocket> => {
    if (!reconnecting) {
      console.log('\nConexão caiu durante uma leitura. Reconectando com segurança...')
      reconnecting = connectRawWhatsApp().finally(() => {
        reconnecting = undefined
      })
    }

    active = await reconnecting
    return active
  }

  const runRead = async <T>(operation: (sock: WASocket) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt <= READ_RECONNECT_ATTEMPTS; attempt += 1) {
      try {
        return await operation(active)
      } catch (error) {
        if (attempt >= READ_RECONNECT_ATTEMPTS || !isTransientReadError(error)) {
          throw error
        }
        await reconnect()
      }
    }

    throw new Error('Falha inesperada na política de reconexão de leitura.')
  }

  const proxy = new Proxy({} as WASocket, {
    get(_target, property) {
      if (property === 'groupMetadata') {
        return (...args: Parameters<WASocket['groupMetadata']>) =>
          runRead((sock) => sock.groupMetadata(...args))
      }

      if (property === 'groupFetchAllParticipating') {
        return (...args: Parameters<WASocket['groupFetchAllParticipating']>) =>
          runRead((sock) => sock.groupFetchAllParticipating(...args))
      }

      // Importante: operações de escrita, especialmente groupParticipantsUpdate,
      // são apenas delegadas ao socket ativo e NUNCA repetidas pelo proxy.
      const value = Reflect.get(active as object, property)
      return typeof value === 'function' ? value.bind(active) : value
    },
  })

  console.log('\nWhatsApp conectado com sucesso.\n')
  return proxy
}
