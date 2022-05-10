const { io } = require('socket.io-client')
const { spawn } = require('child_process')
const mcping = require('mcping-js')
const { Rcon } = require('rcon-client')
const { serverList, webHost } = require('./config.json')
console.log(serverList)


const socket = io(webHost);

var serverLastHadPlayers = {}

socket.on('connect', () => {
	console.log('connected to raspberry pi')
	let serverData = JSON.parse(JSON.stringify(serverList)) // clone serverList
	let consolePasswords = []
	serverData.forEach(server => {
		server.rcon = null
		if (server.consolePassword) {
			consolePasswords.push( { server: server.name, password: server.consolePassword } )
			server.consolePassword = null
		}
	})
	socket.emit('serverList', serverData)
	socket.emit('consolePasswords', consolePasswords)
})

socket.on('startServer', (name) => {
	runServer(name);
})

socket.on('runCommand', (data) => {
	serverList.forEach(async server => {
		if (server.name === data.server) {
			if (server.rconConnection) {
				try {
					console.log(await server.rconConnection.send(data.command))
				} catch (err) {
					console.log(err)
				}
			}
		}
	})
})

function runServer(name) {
	serverList.forEach(server => {
		if (server.name === name && server.running !== true) {
			server.running = true

			const ls = spawn('start.bat', [], { cwd: server.path } )
			ls.stdout.on('data', (data) => {
				console.log(data.toString())
				socket.emit('consoleOutput', { server: server.name, output: data.toString() })
				if (data.toString().includes('For help, type "help"')) { // on server start
					startRcon(server)
					pingOnlineServers()
					serverLastHadPlayers[server.name] = Date.now()
				}
				if (data.toString().substring(10, 32) === 'INFO]: Stopping server') { // on server stop
					socket.emit('serverStopped', server.name)
					try {
						server.rconConnection.end()
						server.rconConnection = null
					} catch (e) {
						console.log(e)
					}
					server.running = false
				}
				if (data.toString() === 'Press any key to continue . . . ') { // on server stop
					socket.emit('serverStopped', server.name)
					try {
						server.rconConnection.end()
						server.rconConnection = null
					} catch (e) {
						console.log(e)
					}
					server.running = false
					ls.kill('SIGINT')
				}
			})
			ls.stderr.on('data', (data) => {
				console.log(data.toString())
			})
			ls.on('close', (code) => {
				console.log(`child process exited with code ${code}`)
			})

		}
	})
}

async function startRcon(server) {
	console.log(server.rcon)
	try {
		const rcon = await Rcon.connect({
			host: server.ip, port: server.rcon.port, password: server.rcon.password
		})
		server.rconConnection = rcon
	} catch (err) {
		console.log(err)
	}
}

function pingOnlineServers() {
	serverList.forEach(server => {
		if (server.running) {
			const pingServer = new mcping.MinecraftServer(server.ip, server.port)

			pingServer.ping(3000, server.protocol, (err, res) => {
				if (err) {
					console.log(err)
				}
				else {
					socket.emit('serverStatus', { server: server.name, status: res })
					if (res.players.online !== 0) {
						serverLastHadPlayers[server.name] = Date.now()
					}
				}
			})
		}
	})
}

setInterval(() => {
	pingOnlineServers()

	serverList.forEach(async server => {
		if (server.running) {
			if (!server.rconConnection) {
				console.log('Attempting to start RCON ' + server.name)
				startRcon(server)
			}
		}
		if (Date.now() - serverLastHadPlayers[server.name] > server.inactivityTimeout * 1000) {
			if (server.rconConnection) {
				console.log('Inactivity timeout reached for ' + server.name)
				try {
					console.log(await server.rconConnection.send('stop'))
				} catch (err) {
					console.log(err)
				}
			}
		}
	})
}, 10000) 