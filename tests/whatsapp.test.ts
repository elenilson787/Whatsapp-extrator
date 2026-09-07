import test from 'node:test'
import assert from 'node:assert/strict'
import { DisconnectReason } from '@whiskeysockets/baileys'
import { classifyDisconnect } from '../src/whatsapp.js'

test('classifyDisconnect trata 515 como reinício automático', () => {
  assert.equal(classifyDisconnect(DisconnectReason.restartRequired), 'restart')
})

test('classifyDisconnect trata logout como sessão inválida', () => {
  assert.equal(classifyDisconnect(DisconnectReason.loggedOut), 'logged-out')
})

test('classifyDisconnect mantém outros códigos como falha', () => {
  assert.equal(classifyDisconnect(503), 'fatal')
  assert.equal(classifyDisconnect(undefined), 'fatal')
})
