const { WebSocketServer } = require('ws');
const http = require('http');

// A simple HTTP server if needed (not strict requirement if just serving ws)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Huroof WebSocket Server is running.');
});

const wss = new WebSocketServer({ server });

let gameState = {
    phase: 'ob',
    board: [],
    turn: 0,
    sel: null,
    buzzer: null,
    stealing: false,
    host: null,
    spectators: [],
    teams: [
        { name: 'الفريق البرتقالي', hex: '#f97316', score: 0, life: false, dir: 'h', players: [] },
        { name: 'الفريق الأخضر', hex: '#8cc63f', score: 0, life: false, dir: 'h', players: [] }
    ],
    cfg: { answerTime: 20, stealTime: 15, swapped: false }
};

wss.on('connection', function connection(ws) {
    // Send current state to new client
    ws.send(JSON.stringify({ type: 'sync', state: gameState }));

    ws.on('message', function message(data) {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'action') {
                // Example action applying
                if (msg.action === 'joinRole') {
                    // remove client from any existing roles
                    gameState.teams[0].players = gameState.teams[0].players.filter(p => p !== msg.name);
                    gameState.teams[1].players = gameState.teams[1].players.filter(p => p !== msg.name);
                    gameState.spectators = gameState.spectators.filter(p => p !== msg.name);
                    if (gameState.host === msg.name) gameState.host = null;

                    if (msg.role === 't0') gameState.teams[0].players.push(msg.name);
                    else if (msg.role === 't1') gameState.teams[1].players.push(msg.name);
                    else if (msg.role === 'host') { if (!gameState.host) gameState.host = msg.name; }
                    else if (msg.role === 'spec') gameState.spectators.push(msg.name);
                }
                else if (msg.action === 'leaveRole') {
                    gameState.teams[0].players = gameState.teams[0].players.filter(p => p !== msg.name);
                    gameState.teams[1].players = gameState.teams[1].players.filter(p => p !== msg.name);
                    gameState.spectators = gameState.spectators.filter(p => p !== msg.name);
                    if (gameState.host === msg.name) gameState.host = null;
                }
                else if (msg.action === 'stateUpdate') {
                    // Update full state directly from one of the clients (e.g. Host)
                    gameState = { ...gameState, ...msg.state };
                }

                // Broadcast new state to all clients
                wss.clients.forEach(function each(client) {
                    if (client.readyState === 1) { // 1 == WebSocket.OPEN
                        client.send(JSON.stringify({ type: 'sync', state: gameState }));
                    }
                });
            }
        } catch (e) {
            console.error('Invalid message format', e);
        }
    });
});

server.listen(8081, () => {
    console.log('WebSocket Server is listening on port 8081');
});
