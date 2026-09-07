import { areJidsSameUser, jidNormalizedUser } from '@whiskeysockets/baileys'

export type IdentityLike =
  | string
  | {
      id?: string | null
      phoneNumber?: string | null
      lid?: string | null
    }

export function normalizeInputJid(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  if (value.includes('@')) {
    return jidNormalizedUser(value)
  }

  const digits = value.replace(/\D/g, '')
  return digits ? `${digits}@s.whatsapp.net` : value
}

export function identityJids(identity: IdentityLike): string[] {
  const rawValues =
    typeof identity === 'string'
      ? [identity]
      : [identity.id, identity.phoneNumber, identity.lid].filter(
          (value): value is string => Boolean(value),
        )

  return [...new Set(rawValues.map(normalizeInputJid).filter(Boolean))]
}

export function sameIdentity(left: IdentityLike, right: IdentityLike): boolean {
  const leftJids = identityJids(left)
  const rightJids = identityJids(right)

  return leftJids.some((leftJid) =>
    rightJids.some(
      (rightJid) => leftJid === rightJid || areJidsSameUser(leftJid, rightJid),
    ),
  )
}

export function parseExcludedIdentities(raw?: string): string[] {
  if (!raw) return []

  return [...new Set(
    raw
      .split(/[;,\n]/)
      .map(normalizeInputJid)
      .filter(Boolean),
  )]
}
