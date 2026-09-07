import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupMetadata } from '@whiskeysockets/baileys'
import {
  assertDestinationCanAttempt,
  destinationAddPermission,
} from '../src/destination-permission.js'

function group(memberAddMode?: boolean): GroupMetadata {
  return { id: 'g@g.us', subject: 'g', creation: 0, participants: [], memberAddMode } as GroupMetadata
}

test('admin sempre pode seguir para tentativa controlada', () => {
  assert.equal(destinationAddPermission(group(false), true), 'admin')
})

test('membro pode seguir quando memberAddMode=true', () => {
  const permission = destinationAddPermission(group(true), false)
  assert.equal(permission, 'members_allowed')
  assert.doesNotThrow(() => assertDestinationCanAttempt(permission, false))
})

test('membro é bloqueado antes da API quando memberAddMode=false', () => {
  const permission = destinationAddPermission(group(false), false)
  assert.equal(permission, 'admins_only')
  assert.throws(() => assertDestinationCanAttempt(permission, true), /abortada antes/i)
})

test('metadata desconhecido exige autorização explícita', () => {
  const permission = destinationAddPermission(group(undefined), false)
  assert.equal(permission, 'unknown')
  assert.throws(() => assertDestinationCanAttempt(permission, false), /ALLOW_NON_ADMIN_DESTINATION/)
  assert.doesNotThrow(() => assertDestinationCanAttempt(permission, true))
})
