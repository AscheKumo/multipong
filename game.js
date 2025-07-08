// Game Constants
const CANVAS_SIZE = 600;
const CENTER_X = CANVAS_SIZE / 2;
const CENTER_Y = CANVAS_SIZE / 2;
const ARENA_RADIUS = 280;
const PADDLE_WIDTH = 80;
const PADDLE_HEIGHT = 20;
const PADDLE_DISTANCE = ARENA_RADIUS + 30;
const BALL_RADIUS = 10;
const BALL_SPEED = 5;
const PADDLE_SPEED = 8;
const MAX_PLAYERS = 6;

// Game State
let gameState = {
    players: {},
    ball: {
        x: CENTER_X,
        y: CENTER_Y,
        vx: BALL_SPEED,
        vy: BALL_SPEED,
        radius: BALL_RADIUS
    },
    gameStarted: false,
    scores: {}
};

// Network State
let peer = null;
let connections = {};
let isHost = false;
let myId = null;
let roomCode = null;
let playerNumber = null;

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('gameContainer');
const statusDiv = document.getElementById('status');

// Initialize Canvas
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

// Player Colors
const PLAYER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];

// Create a new room
document.getElementById('createRoom').addEventListener('click', () => {
    updateStatus('Creating room...');
    
    // Generate a random room code
    roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Initialize peer with the room code as ID
    peer = new Peer(roomCode);
    
    peer.on('open', (id) => {
        myId = id;
        isHost = true;
        playerNumber = 1;
        addPlayer(myId, playerNumber);
        showGameRoom();
        updateStatus('Room created! Share the code with friends.');
    });
    
    peer.on('connection', handleConnection);
    
    peer.on('error', (err) => {
        updateStatus(`Error: ${err.type} - ${err.message}`);
        console.error(err);
    });
});

// Join a room
document.getElementById('joinRoom').addEventListener('click', () => {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    if (!code) {
        updateStatus('Please enter a room code');
        return;
    }
    
    updateStatus('Joining room...');
    
    // Create peer with random ID
    peer = new Peer();
    
    peer.on('open', (id) => {
        myId = id;
        
        // Connect to host using room code as peer ID
        const conn = peer.connect(code);
        
        conn.on('open', () => {
            connections[code] = conn;
            roomCode = code;
            setupConnectionHandlers(conn);
            updateStatus('Connected to room!');
        });
        
        conn.on('error', (err) => {
            updateStatus('Failed to connect to room - check the code and try again');
            console.error(err);
        });
    });
    
    peer.on('connection', handleConnection);
    
    peer.on('error', (err) => {
        updateStatus(`Error: ${err.type} - ${err.message}`);
        console.error(err);
    });
});

// Handle incoming connections
function handleConnection(conn) {
    console.log('Incoming connection from:', conn.peer);
    
    conn.on('open', () => {
        connections[conn.peer] = conn;
        
        if (isHost) {
            // Assign player number to new player
            const usedNumbers = Object.values(gameState.players).map(p => p.number);
            let newPlayerNumber = 1;
            while (usedNumbers.includes(newPlayerNumber) && newPlayerNumber <= MAX_PLAYERS) {
                newPlayerNumber++;
            }
            
            if (newPlayerNumber <= MAX_PLAYERS) {
                // Send current game state to new player
                conn.send({
                    type: 'welcome',
                    playerNumber: newPlayerNumber,
                    gameState: gameState,
                    isHost: false
                });
                
                // Add new player to game state
                addPlayer(conn.peer, newPlayerNumber);
                
                // Broadcast updated player list
                broadcastGameState();
                updatePlayersList();
            } else {
                conn.send({ type: 'roomFull' });
                setTimeout(() => conn.close(), 100);
            }
        }
        
        setupConnectionHandlers(conn);
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

// Setup message handlers for a connection
function setupConnectionHandlers(conn) {
    conn.on('data', (data) => {
        handleMessage(data, conn.peer);
    });
    
    conn.on('close', () => {
        delete connections[conn.peer];
        if (gameState.players[conn.peer]) {
            delete gameState.players[conn.peer];
            updatePlayersList();
            if (isHost) {
                broadcastGameState();
            }
        }
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

// Handle incoming messages
function handleMessage(data, senderId) {
    switch (data.type) {
        case 'welcome':
            playerNumber = data.playerNumber;
            gameState = data.gameState;
            isHost = data.isHost;
            addPlayer(myId, playerNumber);
            updatePlayersList();
            showGameRoom();
            break;
            
        case 'gameState':
            gameState = data.gameState;
            updatePlayersList();
            break;
            
        case 'paddleMove':
            if (gameState.players[senderId]) {
                gameState.players[senderId].angle = data.angle;
            }
            break;
            
        case 'startGame':
            startGame();
            break;
            
        case 'ballUpdate':
            if (!isHost) { // Only accept ball updates from host
                gameState.ball = data.ball;
            }
            break;
            
        case 'roomFull':
            updateStatus('Room is full!');
            break;
    }
}

// Show game room UI
function showGameRoom() {
    document.getElementById('startOptions').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'block';
    document.getElementById('roomCode').textContent = `Room Code: ${roomCode}`;
    
    if (isHost) {
        document.getElementById('startGame').style.display = 'block';
    }
    
    updatePlayersList();
}

// Add player to game
function addPlayer(id, number) {
    const angle = (number - 1) * (Math.PI * 2 / MAX_PLAYERS);
    gameState.players[id] = {
        id: id,
        number: number,
        angle: angle,
        score: 0,
        color: PLAYER_COLORS[number - 1]
    };
    gameState.scores[id] = 0;
}

// Update players list UI
function updatePlayersList() {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '<h3>Players:</h3>';
    
    for (let i = 1; i <= MAX_PLAYERS; i++) {
        const player = Object.values(gameState.players).find(p => p.number === i);
        const div = document.createElement('div');
        div.className = 'player-slot' + (player ? ' active' : '');
        div.textContent = player ? `Player ${i}` + (player.id === myId ? ' (You)' : '') : `Empty Slot ${i}`;
        div.style.borderColor = PLAYER_COLORS[i - 1];
        playersList.appendChild(div);
    }
}

// Broadcast game state to all connections
function broadcastGameState() {
    const message = {
        type: 'gameState',
        gameState: gameState
    };
    
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            conn.send(message);
        }
    });
}

// Start game button
document.getElementById('startGame').addEventListener('click', () => {
    if (Object.keys(gameState.players).length < 2) {
        updateStatus('Need at least 2 players to start');
        return;
    }
    
    // Notify all players to start
    Object.values(connections).forEach(conn => {
        conn.send({ type: 'startGame' });
    });
    
    startGame();
});

// Start the game
function startGame() {
    gameState.gameStarted = true;
    lobby.style.display = 'none';
    gameContainer.style.display = 'block';
    gameLoop();
}

// Game loop
function gameLoop() {
    if (!gameState.gameStarted) return;
    
    // Handle input
    handleInput();
    
    // Update game state (only host updates ball)
    if (isHost) {
        updateBall();
        // Broadcast ball position
        Object.values(connections).forEach(conn => {
            if (conn.open) {
                conn.send({
                    type: 'ballUpdate',
                    ball: gameState.ball
                });
            }
        });
    }
    
    // Render game
    render();
    
    requestAnimationFrame(gameLoop);
}

// Handle keyboard input
let keys = {};
window.addEventListener('keydown', (e) => { keys[e.key] = true; });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

function handleInput() {
    const player = gameState.players[myId];
    if (!player) return;
    
    let moved = false;
    if (keys['ArrowLeft'] || keys['a']) {
        player.angle -= PADDLE_SPEED * 0.01;
        moved = true;
    }
    if (keys['ArrowRight'] || keys['d']) {
        player.angle += PADDLE_SPEED * 0.01;
        moved = true;
    }
    
    // Broadcast paddle movement
    if (moved) {
        Object.values(connections).forEach(conn => {
            if (conn.open) {
                conn.send({
                    type: 'paddleMove',
                    angle: player.angle
                });
            }
        });
    }
}

// Update ball physics (host only)
function updateBall() {
    const ball = gameState.ball;
    
    // Move ball
    ball.x += ball.vx;
    ball.y += ball.vy;
    
    // Check collision with paddles
    Object.values(gameState.players).forEach(player => {
        if (checkPaddleCollision(ball, player)) {
            // Reflect ball
            const angleToCenter = Math.atan2(ball.y - CENTER_Y, ball.x - CENTER_X);
            ball.vx = Math.cos(angleToCenter) * BALL_SPEED;
            ball.vy = Math.sin(angleToCenter) * BALL_SPEED;
            
            // Move ball away from paddle
            ball.x = CENTER_X + Math.cos(angleToCenter) * (PADDLE_DISTANCE - PADDLE_HEIGHT - ball.radius - 1);
            ball.y = CENTER_Y + Math.sin(angleToCenter) * (PADDLE_DISTANCE - PADDLE_HEIGHT - ball.radius - 1);
        }
    });
    
    // Check if ball is out of bounds
    const distFromCenter = Math.sqrt(Math.pow(ball.x - CENTER_X, 2) + Math.pow(ball.y - CENTER_Y, 2));
    if (distFromCenter > ARENA_RADIUS + 50) {
        // Reset ball
        ball.x = CENTER_X;
        ball.y = CENTER_Y;
        const randomAngle = Math.random() * Math.PI * 2;
        ball.vx = Math.cos(randomAngle) * BALL_SPEED;
        ball.vy = Math.sin(randomAngle) * BALL_SPEED;
    }
}

// Check collision between ball and paddle
function checkPaddleCollision(ball, player) {
    const paddleX = CENTER_X + Math.cos(player.angle) * PADDLE_DISTANCE;
    const paddleY = CENTER_Y + Math.sin(player.angle) * PADDLE_DISTANCE;
    
    // Simple distance-based collision
    const dist = Math.sqrt(Math.pow(ball.x - paddleX, 2) + Math.pow(ball.y - paddleY, 2));
    return dist < PADDLE_WIDTH / 2 + ball.radius;
}

// Render game
function render() {
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    
    // Draw arena
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw paddles
    Object.values(gameState.players).forEach(player => {
        const x = CENTER_X + Math.cos(player.angle) * PADDLE_DISTANCE;
        const y = CENTER_Y + Math.sin(player.angle) * PADDLE_DISTANCE;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(player.angle + Math.PI / 2);
        ctx.fillStyle = player.color;
        ctx.fillRect(-PADDLE_WIDTH / 2, -PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
        ctx.restore();
    });
    
    // Draw ball
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
    ctx.fill();
}

// Update status message
function updateStatus(message) {
    statusDiv.textContent = message;
}

// Back to lobby button
document.getElementById('backToLobby').addEventListener('click', () => {
    gameState.gameStarted = false;
    gameContainer.style.display = 'none';
    lobby.style.display = 'block';
});

// Leave room button
document.getElementById('leaveRoom').addEventListener('click', () => {
    // Close all connections
    Object.values(connections).forEach(conn => conn.close());
    connections = {};
    
    // Reset game state
    gameState = {
        players: {},
        ball: {
            x: CENTER_X,
            y: CENTER_Y,
            vx: BALL_SPEED,
            vy: BALL_SPEED,
            radius: BALL_RADIUS
        },
        gameStarted: false,
        scores: {}
    };
    
    // Reset UI
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('startOptions').style.display = 'block';
    document.getElementById('joinCode').value = '';
    
    // Destroy peer connection
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    isHost = false;
    myId = null;
    roomCode = null;
    playerNumber = null;
    
    updateStatus('Left room');
});
