const { EventEmitter } = require('events')
const Module = require('module')
const minecraftData = require('minecraft-data')

const MODERN_VERSIONS = new Set(['26.1.2', '26.2'])

let dataShimInstalled = false
let protocol26_2

function isModernVersion(version) {
    return MODERN_VERSIONS.has(version)
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function get26_2Data() {
    if (protocol26_2) return protocol26_2

    const base = minecraftData('26.1')
    if (!base) throw new Error('Minecraft 26.1 protocol data is not installed.')

    const protocol = clone(base.protocol)

    // Protocol 776 data from PrismarineJS/minecraft-data pc_26_2 at
    // 4dd8762a45b97dafdb216b8d7a95ab92379e2c68. Compared with protocol 775,
    // 26.2 only adds sessionId to login success and onlineMode to play login.
    protocol.login.toClient.types.packet_success[1] = [
        { name: 'uuid', type: 'UUID' },
        { name: 'username', type: 'string' },
        {
            name: 'properties',
            type: ['array', {
                countType: 'varint',
                type: ['container', [
                    { name: 'name', type: 'string' },
                    { name: 'value', type: 'string' },
                    { name: 'signature', type: ['option', 'string'] }
                ]]
            }]
        },
        { name: 'sessionId', type: 'UUID' }
    ]

    protocol.play.toClient.types.packet_login[1] = [
        { name: 'entityId', type: 'i32' },
        { name: 'isHardcore', type: 'bool' },
        { name: 'worldNames', type: ['array', { countType: 'varint', type: 'string' }] },
        { name: 'maxPlayers', type: 'varint' },
        { name: 'viewDistance', type: 'varint' },
        { name: 'simulationDistance', type: 'varint' },
        { name: 'reducedDebugInfo', type: 'bool' },
        { name: 'enableRespawnScreen', type: 'bool' },
        { name: 'doLimitedCrafting', type: 'bool' },
        { name: 'worldState', type: 'SpawnInfo' },
        { name: 'onlineMode', type: 'bool' },
        { name: 'enforcesSecureChat', type: 'bool' }
    ]

    protocol26_2 = {
        ...base,
        protocol,
        version: {
            ...base.version,
            version: 776,
            minecraftVersion: '26.2',
            majorVersion: '26.2',
            releaseType: 'release'
        }
    }

    return protocol26_2
}

function installMinecraftDataShim() {
    if (dataShimInstalled) return

    function modernMinecraftData(version) {
        if (version === '26.2' || version === 776) return get26_2Data()
        return minecraftData(version)
    }

    Object.assign(modernMinecraftData, minecraftData)

    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
        if (request === 'minecraft-data') return modernMinecraftData
        return originalLoad.call(this, request, parent, isMain)
    }

    dataShimInstalled = true
}

function textFromComponent(component) {
    if (component == null) return ''
    if (Buffer.isBuffer(component)) return component.toString('utf8')
    if (Array.isArray(component)) return component.map(textFromComponent).join('')
    if (typeof component !== 'object') {
        if (typeof component !== 'string') return String(component)
        try {
            return textFromComponent(JSON.parse(component))
        } catch {
            return component
        }
    }

    if (component.type === 'string' && typeof component.value === 'string') {
        return component.value
    }

    const value = component.value && typeof component.value === 'object'
        ? textFromComponent(component.value)
        : ''
    const text = textFromComponent(component.text ?? component.content ?? component.literal)
    const translated = text || value || (component.translate ? String(component.translate) : '')
    const args = textFromComponent(component.with)
    const extra = textFromComponent(component.extra)
    return `${translated}${args}${extra}`
}

class ModernBot extends EventEmitter {
    constructor(options) {
        super()
        this.options = { ...options, auth: options.auth || 'offline' }
        this.username = options.username
        this.version = options.version
        this.chatOnly = true
        this.client = null
        this.joined = false
        this.ending = false
        this.sentPlayerLoaded = false

        // Keep later protocol errors from becoming unhandled after the UI's
        // one-shot error listener has already fired.
        this.on('error', () => {})
        setImmediate(() => this.connect())
    }

    connect() {
        if (this.ending) return

        try {
            installMinecraftDataShim()
            const protocol = require('minecraft-protocol')
            this.client = protocol.createClient(this.options)
            this.bindClient()
        } catch (error) {
            this.emit('error', error)
        }
    }

    bindClient() {
        const client = this.client

        client.on('session', session => {
            if (session?.selectedProfile?.name) this.username = session.selectedProfile.name
        })

        client.once('playerJoin', () => {
            this.joined = true
            this.username = client.username || this.username
            this.emit('login')
            this.emit('spawn')
        })

        client.on('position', packet => {
            client.write('teleport_confirm', { teleportId: packet.teleportId })
            if (!this.sentPlayerLoaded) {
                this.sentPlayerLoaded = true
                client.write('player_loaded', {})
            }
        })

        client.on('ping', packet => {
            client.write('pong', { id: packet.id })
        })

        client.on('playerChat', packet => {
            const message = textFromComponent(
                packet.plainMessage ?? packet.unsignedContent ?? packet.formattedMessage
            )
            const sender = textFromComponent(packet.senderName)
            this.emit('messagestr', sender ? `<${sender}> ${message}` : message)
        })

        client.on('systemChat', packet => {
            this.emit('messagestr', textFromComponent(packet.formattedMessage))
        })

        let kicked = false
        const onKick = packet => {
            if (kicked) return
            kicked = true
            this.emit('kicked', textFromComponent(packet?.reason ?? packet))
        }
        client.on('disconnect', onKick)
        client.on('kick_disconnect', onKick)

        client.on('error', error => this.emit('error', error))
        client.once('end', reason => {
            this.joined = false
            this.emit('end', reason || 'Connection closed')
        })
    }

    chat(message) {
        if (!this.joined || typeof this.client?.chat !== 'function') {
            this.emit('error', new Error(`${this.username} is not ready to chat.`))
            return
        }

        try {
            this.client.chat(String(message))
        } catch (error) {
            this.emit('error', error)
        }
    }

    quit(reason = 'Disconnected by user') {
        this.ending = true
        this.client?.end(reason)
    }
}

function createModernBot(options) {
    if (!isModernVersion(options.version)) {
        throw new Error(`Unsupported modern protocol version: ${options.version}`)
    }
    return new ModernBot(options)
}

installMinecraftDataShim()

module.exports = {
    createModernBot,
    get26_2Data,
    installMinecraftDataShim,
    isModernVersion,
    textFromComponent
}
