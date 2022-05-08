const { io } = require('socket.io-client')
const { spawn } = require('child_process')
const mcping = require('mcping-js')
const { Rcon } = require('rcon-client')
const serverList = require('./serverList.json')
console.log(serverList)
const raspberryPI_IP = 'http://localhost:3000'

const socket = io(raspberryPI_IP);

socket.on('connect', () => {
	console.log('connected to raspberry pi')
	let serverData = JSON.parse(JSON.stringify(serverList)) // clone serverList
	serverData.forEach(server => {
		server.rcon = null
	})
	socket.emit('serverList', serverData)
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
				}
			})
		}
	})
}

setInterval(() => {
	pingOnlineServers()

	serverList.forEach(server => {
		if (server.running) {
			if (!server.rconConnection) {
				console.log('Attempting to start RCON ' + server.name)
				startRcon(server)
			}
		}
	})
}, 10000) 