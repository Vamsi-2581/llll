// Exercise application HTTP/WebSocket endpoints on a separately provisioned
// initial-release fixture. This script performs no Cloudflare account operations.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const statePath = resolve(process.argv[2] || '.deployment/initial-stage.json')
const state = JSON.parse(await readFile(statePath, 'utf8'))
assert.match(state.prefix, /^l4-init-[a-f0-9]{8}$/)
const hostname = new URL(state.origin).hostname
assert.ok(hostname.startsWith(`${state.installation}.`) && hostname.endsWith('.workers.dev'))
const ownerToken = state.ownerToken

async function api(path, { method = 'GET', body, token = ownerToken, expected = 200 } = {}) {
  console.log(`${method} ${path}`)
  const response = await fetch(state.origin + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(path.includes('backup') ? 120000 : 30000),
    headers: { Origin: state.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}`)
  return { response, payload: await response.json() }
}

async function socketAuthentication(serverId, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/s/${serverId}/ws/workspace/main`, state.origin)
    url.protocol = 'wss:'
    const socket = new WebSocket(url, { origin: state.origin, handshakeTimeout: 10000 })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Socket authentication timed out')) }, 15000)
    const done = value => { clearTimeout(timer); socket.close(); resolve(value) }
    socket.once('open', () => socket.send(JSON.stringify({ t: 'auth', token })))
    socket.once('message', data => done(JSON.parse(data.toString())))
    socket.once('close', () => done({ t: 'closed' }))
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
}

for (const server of state.servers) {
  const directory = await api('/api/installation/servers')
  if (!directory.payload.servers.some(item => item.id === server.id)) {
    await api('/api/installation/servers/register', { method: 'POST', expected: 201, body: { id: server.id, name: server.id, origin: server.origin, key: server.key } })
  }
  const me = await api(`/s/${server.id}/api/me`)
  assert.equal(me.payload.user.id, state.ownerId)
  const channels = await api(`/s/${server.id}/api/workspaces/main/channels`)
  server.channelId = channels.payload.channels.find(channel => channel.name === 'general').id
}
const [alpha, beta] = state.servers
assert.notEqual(alpha.channelId, beta.channelId)
const content = `Initial release isolation ${randomUUID()}`
const sent = await api(`/s/${alpha.id}/api/channels/${alpha.channelId}/messages`, { method: 'POST', body: { content, clientId: randomUUID() } })
const messages = await api(`/s/${alpha.id}/api/channels/${alpha.channelId}/messages`)
assert.ok(messages.payload.messages.some(message => message.id === sent.payload.message.id && message.content === content))
await api(`/s/${beta.id}/api/channels/${alpha.channelId}/messages`, { expected: 404 })

const directory = await api('/api/installation/servers')
assert.equal(directory.payload.servers.length, 2)
for (const server of directory.payload.servers) assert.match(server.publicId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const ticket = await api(`/s/${alpha.id}/api/auth/ws-token`, { method: 'POST', body: {} })
assert.equal((await socketAuthentication(alpha.id, ticket.payload.token)).t, 'hello')
const wrongTicket = await api(`/s/${alpha.id}/api/auth/ws-token`, { method: 'POST', body: {} })
assert.notEqual((await socketAuthentication(beta.id, wrongTicket.payload.token)).t, 'hello')

const form = new FormData()
form.append('file', new File([content], 'initial.txt', { type: 'text/plain' }))
const uploaded = await fetch(`${state.origin}/s/${alpha.id}/api/channels/${alpha.channelId}/attachments`, { method: 'POST', headers: { Origin: state.origin, Authorization: `Bearer ${ownerToken}` }, body: form })
assert.equal(uploaded.status, 200)
const attachment = (await uploaded.json()).attachment
const grant = directory.payload.servers.find(server => server.id === alpha.id).assetToken
const file = await fetch(`${state.origin}/s/${alpha.id}/api/files/${attachment.id}?llll_asset=${encodeURIComponent(grant)}`)
assert.equal(file.status, 200)
assert.equal(await file.text(), content)
await api(`/s/${beta.id}/api/files/${attachment.id}`, { expected: 404 })

const invite = await api(`/api/installation/servers/${alpha.id}/invites`, { method: 'POST', body: {} })
const signup = await api('/api/auth/sign-up/email', { token: '', method: 'POST', body: { name: 'Invited member', email: `member-${randomUUID()}@example.com`, password: state.ownerPassword, inviteToken: invite.payload.invite.token } })
const memberToken = signup.response.headers.get('set-auth-token')
assert.ok(memberToken)
await api(`/s/${alpha.id}/api/me`, { token: memberToken })
await api(`/s/${beta.id}/api/me`, { token: memberToken, expected: 403 })
const revokedTicket = await api(`/s/${alpha.id}/api/auth/ws-token`, { token: memberToken, method: 'POST', body: {} })
await api('/api/auth/sign-out', { token: memberToken, method: 'POST', body: {} })
await api(`/s/${alpha.id}/api/me`, { token: memberToken, expected: 401 })
assert.notEqual((await socketAuthentication(alpha.id, revokedTicket.payload.token)).t, 'hello')

const serverBackup = await api(`/s/${alpha.id}/api/workspaces/main/backup-to-bucket`, { method: 'POST', body: {} })
const instanceBackup = await api('/api/installation/backup', { method: 'POST', body: {} })
assert.ok(serverBackup.payload.sizeBytes > 0)
assert.ok(instanceBackup.payload.sizeBytes > 0)
assert.notEqual(serverBackup.payload.key, instanceBackup.payload.key)
state.verification = { version: '0.1.0-alpha.1', completedAt: new Date().toISOString(), serverBackup: serverBackup.payload.key, instanceBackup: instanceBackup.payload.key }
await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
console.log('PASS: live isolated Instance, two Servers, UUID routing, owner/member admission, messages, cross-server denial, real WebSocket handshakes and logout revocation, private files and separate backups')
