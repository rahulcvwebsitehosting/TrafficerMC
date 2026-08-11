const test = require('node:test')
const assert = require('node:assert/strict')

const {
    get26_2Data,
    isModernVersion,
    textFromComponent
} = require('../assets/js/modernBot')

test('routes only the experimental modern versions', () => {
    assert.equal(isModernVersion('26.1.2'), true)
    assert.equal(isModernVersion('26.2'), true)
    assert.equal(isModernVersion('1.21.11'), false)
})

test('builds protocol 776 with the two 26.2 login fields', () => {
    const data = get26_2Data()
    const successFields = data.protocol.login.toClient.types.packet_success[1]
    const loginFields = data.protocol.play.toClient.types.packet_login[1]

    assert.equal(data.version.minecraftVersion, '26.2')
    assert.equal(data.version.version, 776)
    assert.equal(successFields.at(-1).name, 'sessionId')
    assert.equal(successFields.at(-1).type, 'UUID')
    assert.equal(loginFields.at(-2).name, 'onlineMode')
    assert.equal(loginFields.at(-2).type, 'bool')
})

test('minecraft-protocol can initialize both modern clients', () => {
    const protocol = require('minecraft-protocol')
    const clients = [
        protocol.createClient({
            username: 'ProtocolTest2612',
            version: '26.1.2',
            connect: () => {}
        }),
        protocol.createClient({
            username: 'ProtocolTest262',
            version: '26.2',
            connect: () => {}
        })
    ]

    assert.equal(clients[0].version, '26.1')
    assert.equal(clients[1].version, '26.2')
})

test('renders common chat component shapes', () => {
    assert.equal(textFromComponent('{"text":"hello","extra":[{"text":" world"}]}'), 'hello world')
    assert.equal(textFromComponent({ type: 'string', value: 'server message' }), 'server message')
})
