const test = require('node:test')
const assert = require('node:assert/strict')
const nbt = require('prismarine-nbt')

const { createModernBot } = require('../assets/js/modernBot')
const protocol = require('minecraft-protocol')
const minecraftData = require('minecraft-data')

function verifyModernVersion(version) {
    return new Promise((resolve, reject) => {
        const data = minecraftData(version)
        const result = {
            chatReceived: false,
            systemChatReceived: false,
            teleportConfirmed: false,
            playerLoaded: false,
            loginAfterPlayPacket: false,
            spawnAfterPosition: false
        }
        let sentPlayLogin = false
        let sentPosition = false
        let bot
        let settled = false

        const server = protocol.createServer({
            'online-mode': false,
            host: '127.0.0.1',
            port: 0,
            version,
            registryCodec: data.loginPacket.dimensionCodec,
            beforeLogin(client) {
                if (version !== '26.2') return
                const originalWrite = client.write.bind(client)
                client.write = (name, params) => originalWrite(name, name === 'success'
                    ? { ...params, sessionId: '00000000-0000-0000-0000-000000000026' }
                    : params)
            }
        })

        const timeout = setTimeout(() => {
            finish(new Error(`${version} integration timed out: ${JSON.stringify(result)}`))
        }, 20000)

        function finish(error) {
            if (settled) return
            if (!error && !Object.values(result).every(Boolean)) return
            settled = true
            clearTimeout(timeout)
            bot?.quit('Integration test complete')
            server.close()
            error ? reject(error) : resolve(result)
        }

        server.on('error', finish)
        server.on('playerJoin', client => {
            client.on('error', finish)
            client.on('teleport_confirm', packet => {
                result.teleportConfirmed = packet.teleportId === 42
                finish()
            })
            client.on('player_loaded', () => {
                result.playerLoaded = true
                finish()
            })
            client.on('chat_message', packet => {
                result.chatReceived = packet.message === `hello from ${version}`
                client.write('system_chat', {
                    content: nbt.comp({ text: nbt.string(`server reply ${version}`) }),
                    isActionBar: false
                })
                finish()
            })
            // Keep a gap after configuration so the test catches adapters
            // that incorrectly treat `playerJoin` as a completed game join.
            setTimeout(() => {
                sentPlayLogin = true
                client.write('login', { ...data.loginPacket, entityId: client.id, onlineMode: false })
                setTimeout(() => {
                    sentPosition = true
                    client.write('position', {
                        teleportId: 42,
                        x: 0,
                        y: 64,
                        z: 0,
                        dx: 0,
                        dy: 0,
                        dz: 0,
                        yaw: 0,
                        pitch: 0,
                        flags: {}
                    })
                }, 75)
            }, 75)
        })

        server.once('listening', () => {
            bot = createModernBot({
                username: `Local${version.replaceAll('.', '')}`,
                host: '127.0.0.1',
                port: server.socketServer.address().port,
                version,
                auth: 'offline'
            })
            bot.on('error', finish)
            bot.on('login', () => {
                result.loginAfterPlayPacket = sentPlayLogin
            })
            bot.on('spawn', () => {
                result.spawnAfterPosition = sentPosition
                bot.chat(`hello from ${version}`)
            })
            bot.on('messagestr', message => {
                if (message.includes(`server reply ${version}`)) {
                    result.systemChatReceived = true
                }
                finish()
            })
        })
    })
}

test('26.1.2 and 26.2 bots join and exchange chat', { timeout: 30000 }, async () => {
    const results = await Promise.all([
        verifyModernVersion('26.1.2'),
        verifyModernVersion('26.2')
    ])

    for (const result of results) {
        assert.deepEqual(result, {
            chatReceived: true,
            systemChatReceived: true,
            teleportConfirmed: true,
            playerLoaded: true,
            loginAfterPlayPacket: true,
            spawnAfterPosition: true
        })
    }
})
