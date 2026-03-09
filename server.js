const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Serve index.html from /public folder so frontend + backend live together
const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
});

const wss = new WebSocketServer({ server });

// Store all active rooms
const rooms = {};

// Helper to spawn a fresh game state
function createGameState() {
    return {
        phase: 'ob',
        board: [],
        turn: 0,
        sel: null,
        buzzer: null,
        stealing: false,
        host: null,
        spectators: [],
        teams: [
            { name: 'الفريق البرتقالي', hex: '#f97316', key: 'orange', score: 0, life: false, dir: 'h', players: [] },
            { name: 'الفريق الأخضر', hex: '#8cc63f', key: 'green', score: 0, life: false, dir: 'v', players: [] }
        ],
        cfg: { answerTime: 20, stealTime: 15, swapped: false },
        timerData: { val: 0, paused: false, run: false }
    };
}

// Generate a random 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

// Broadcast state specifically to clients in a particular room
function broadcastToRoom(roomId) {
    if (!rooms[roomId]) return;
    const msg = JSON.stringify({ type: 'sync', state: rooms[roomId] });
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.roomId === roomId) {
            client.send(msg);
        }
    });
}

wss.on('connection', function connection(ws) {
    ws.roomId = null;
    ws.playerName = null;
    ws.playerRole = null;

    ws.on('message', function message(data) {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'action') {
                // 1. CREATE OR JOIN ROOM
                if (msg.action === 'joinRole') {
                    let roomId;
                    if (msg.createRoom && msg.role === 'host') {
                        // Host creates a new room
                        roomId = generateRoomCode();
                        rooms[roomId] = createGameState();
                        rooms[roomId].hostCode = roomId; // Ensure clients know their room code

                        // Send the room code back to the creator explicitly
                        ws.send(JSON.stringify({ type: 'roomCreated', roomCode: roomId }));
                    } else {
                        // Player joins existing room
                        roomId = msg.roomCode;
                        if (!rooms[roomId]) {
                            ws.send(JSON.stringify({ type: 'error', message: 'الغرفة غير موجودة. تأكد من الكود.' }));
                            return;
                        }
                    }

                    ws.roomId = roomId;
                    ws.playerName = msg.name;
                    ws.playerRole = msg.role;
                    const gameState = rooms[roomId];

                    // Remove client from any existing roles in this room to prevent duplicates
                    gameState.teams[0].players = gameState.teams[0].players.filter(p => p !== msg.name);
                    gameState.teams[1].players = gameState.teams[1].players.filter(p => p !== msg.name);
                    gameState.spectators = gameState.spectators.filter(p => p !== msg.name);
                    if (gameState.host === msg.name) gameState.host = null;

                    // Assign new role
                    if (msg.role === 't0') gameState.teams[0].players.push(msg.name);
                    else if (msg.role === 't1') gameState.teams[1].players.push(msg.name);
                    else if (msg.role === 'host') { if (!gameState.host) gameState.host = msg.name; }
                    else if (msg.role === 'spec') gameState.spectators.push(msg.name);

                    broadcastToRoom(roomId);
                }
                else if (msg.action === 'leaveRole') {
                    const roomId = ws.roomId;
                    if (roomId && rooms[roomId]) {
                        const gameState = rooms[roomId];
                        gameState.teams[0].players = gameState.teams[0].players.filter(p => p !== msg.name);
                        gameState.teams[1].players = gameState.teams[1].players.filter(p => p !== msg.name);
                        gameState.spectators = gameState.spectators.filter(p => p !== msg.name);
                        if (gameState.host === msg.name) gameState.host = null;

                        ws.roomId = null;
                        ws.playerRole = null;

                        // If room is completely empty (no host, no players, no specs), delete it
                        const isEmpty = !gameState.host && gameState.teams[0].players.length === 0 && gameState.teams[1].players.length === 0 && gameState.spectators.length === 0;
                        if (isEmpty) {
                            delete rooms[roomId];
                        } else {
                            broadcastToRoom(roomId);
                        }
                    }
                }
                else if (msg.action === 'stateUpdate') {
                    // Update room state directly from a client
                    const roomId = ws.roomId;
                    if (roomId && rooms[roomId]) {
                        rooms[roomId] = { ...rooms[roomId], ...msg.state };
                        broadcastToRoom(roomId);
                    }
                }
            }
        } catch (e) {
            console.error('Invalid message format', e);
        }
    });

    ws.on('close', () => {
        // Auto-leave role on disconnect
        if (ws.roomId && rooms[ws.roomId] && ws.playerName) {
            const gameState = rooms[ws.roomId];
            gameState.teams[0].players = gameState.teams[0].players.filter(p => p !== ws.playerName);
            gameState.teams[1].players = gameState.teams[1].players.filter(p => p !== ws.playerName);
            gameState.spectators = gameState.spectators.filter(p => p !== ws.playerName);
            if (gameState.host === ws.playerName) gameState.host = null;

            // Clean up empty room
            const isEmpty = !gameState.host && gameState.teams[0].players.length === 0 && gameState.teams[1].players.length === 0 && gameState.spectators.length === 0;
            if (isEmpty) delete rooms[ws.roomId];
            else broadcastToRoom(ws.roomId);
        }
    });
});

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
    console.log('WebSocket Server is listening on port ' + PORT);
});
