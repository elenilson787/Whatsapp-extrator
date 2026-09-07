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

const AUTH_DIR = 'data/auth'

export async function connectWhatsApp(): Promise<ConnectedClient> {
  await mkdir('data', { recursive: true })

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
        console.log('\nWhatsApp conectado com sucesso.\n')
        resolve(sock)
      }

      if (connection === 'close' && !settled) {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        settled = true

        reject(
          new Error(
            loggedOut
              ? 'A sessão foi encerrada no WhatsApp. Remova data/auth e conecte novamente.'
              : `Não foi possível conectar ao WhatsApp. Código: ${code ?? 'desconhecido'}`,
          ),
        )
      }
    })
  })
}
