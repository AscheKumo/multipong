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
const COUNTDOWN_TIME = 3; // seconds

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
    countdown: 0,
    countdownStartTime: 0,
    scores: {}
};

// Network State
let peer = null;
let connections = {};
let isHost = false;
let myId = null;
let myPeerId = null;
let roomCode = null;
let playerNumber = null;

// Control State
let keys = {};
let mouseAngle = null;
let useMouseControl = false;

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

// Setup input handlers
window.addEventListener('keydown', (e) => { 
    keys[e.key.toLowerCase()] = true;
    e.preventDefault();
});
window.addEventListener('keyup', (e) => { 
    keys[e.key.toLowerCase()] = false;
    e.preventDefault();
});

// Mouse controls
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calculate angle from center to mouse
    mouseAngle = Math.atan2(y - CENTER_Y, x - CENTER_X);
    useMouseControl = true;
});

canvas.addEventListener('mouseleave', () => {
    useMouseControl = false;
});

// Create a new room
document.getElementById('createRoom').addEventListener('click', () => {
    updateStatus('Creating room...');
    
    // Create peer with auto-generated ID
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        myId = id;
        isHost = true;
        
        // Create a short room code from the peer ID
        roomCode = id.slice(-6).toUpperCase();
        
        playerNumber = 1;
        addPlayer(myId, playerNumber);
        showGameRoom();
        
        // Show the full peer ID in console for debugging
        console.log('Room created with peer ID:', id);
        updateStatus('Room created! Share the code with friends.');
        
        // Update room code display with full ID for now
        document.getElementById('roomCode').innerHTML = `
            <div>Room Code (short): <strong>${roomCode}</strong></div>
            <div style="font-size: 12px; margin-top: 10px;">
                Full ID (for troubleshooting): <br>
                <code style="background: #222; padding: 5px; border-radius: 3px; word-break: break-all;">${id}</code>
            </div>
        `;
    });
    
    peer.on('connection', handleConnection);
    
    peer.on('error', (err) => {
        updateStatus(`Error: ${err.type} - ${err.message}`);
        console.error('PeerJS Error:', err);
    });
    
    peer.on('disconnected', () => {
        updateStatus('Disconnected from signaling server');
    });
});

// Join a room
document.getElementById('joinRoom').addEventListener('click', () => {
    const inputCode = document.getElementById('joinCode').value.trim();
    if (!inputCode) {
        updateStatus('Please enter a room code or peer ID');
        return;
    }
    
    updateStatus('Connecting to room...');
    
    // Create peer with auto-generated ID
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        myId = id;
        console.log('My peer ID:', id);
        
        // Try to connect with the input (could be short code or full ID)
        attemptConnection(inputCode);
    });
    
    peer.on('connection', handleConnection);
    
    peer.on('error', (err) => {
        updateStatus(`Error: ${err.type} - ${err.message}`);
        console.error('PeerJS Error:', err);
    });
});

// Attempt to connect to host
function attemptConnection(hostId) {
    console.log('Attempting to connect to:', hostId);
    
    const conn = peer.connect(hostId, {
        reliable: true
    });
    
    conn.on('open', () => {
        console.log('Connection opened to host');
        connections[hostId] = conn;
        roomCode = hostId.slice(-6).toUpperCase();
        setupConnectionHandlers(conn);
        updateStatus('Connected to room! Waiting for host...');
    });
    
    conn.on('error', (err) => {
        updateStatus('Failed to connect - make sure you have the correct code');
        console.error('Connection error:', err);
    });
}

// Handle incoming connections
function handleConnection(conn) {
    console.log('Incoming connection from:', conn.peer);
    
    conn.on('open', () => {
        console.log('Connection opened from:', conn.peer);
        connections[conn.peer] = conn;
        
        if (isHost) {
            // Assign player number to new player
            const usedNumbers = Object.values(gameState.players).map(p => p.number);
            let newPlayerNumber = 1;
            while (usedNumbers.includes(newPlayerNumber) && newPlayerNumber <= MAX_PLAYERS) {
                newPlayerNumber++;
            }
            
            if (newPlayerNumber <= MAX_PLAYERS) {
                // Add new player to game state first
                addPlayer(conn.peer, newPlayerNumber);
                
                // Send welcome message with game state
                conn.send({
                    type: 'welcome',
                    playerNumber: newPlayerNumber,
                    gameState: gameState,
                    isHost: false
                });
                
                // Update UI and broadcast to other players
                updatePlayersList();
                broadcastGameState();
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
        console.log('Received data:', data.type);
        handleMessage(data, conn.peer);
    });
    
    conn.on('close', () => {
        console.log('Connection closed:', conn.peer);
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
            updateStatus('Joined room successfully!');
            break;
            
        case 'gameState':
            // Update other players, but keep our own player data
            const myPlayer = gameState.players[myId];
            gameState = data.gameState;
            if (myPlayer) {
                gameState.players[myId] = myPlayer;
            }
            updatePlayersList();
            break;
            
        case 'paddleMove':
            if (gameState.players[senderId]) {
                gameState.players[senderId].angle = data.angle;
            }
            break;
            
        case 'startCountdown':
            startCountdown();
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
        targetAngle: angle,
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
    
    // Notify all players to start countdown
    Object.values(connections).forEach(conn => {
        conn.send({ type: 'startCountdown' });
    });
    
    startCountdown();
});

// Start countdown
function startCountdown() {
    gameState.countdown = COUNTDOWN_TIME;
    gameState.countdownStartTime = Date.now();
    lobby.style.display = 'none';
    gameContainer.style.display = 'block';
    gameLoop();
}

// Start the game
function startGame() {
    gameState.gameStarted = true;
    gameState.countdown = 0;
    
    // Reset ball position and give it a random direction
    gameState.ball.x = CENTER_X;
    gameState.ball.y = CENTER_Y;
    const randomAngle = Math.random() * Math.PI * 2;
    gameState.ball.vx = Math.cos(randomAngle) * BALL_SPEED;
    gameState.ball.vy = Math.sin(randomAngle) * BALL_SPEED;
}

// Game loop
function gameLoop() {
    if (!gameState.gameStarted && gameState.countdown <= 0) return;
    
    // Update countdown
    if (gameState.countdown > 0) {
        const elapsed = (Date.now() - gameState.countdownStartTime) / 1000;
        gameState.countdown = Math.max(0, COUNTDOWN_TIME - elapsed);
        
        if (gameState.countdown <= 0 && !gameState.gameStarted) {
            startGame();
        }
    }
    
    // Handle input
    handleInput();
    
    // Update game state (only host updates ball)
    if (isHost && gameState.gameStarted) {
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

// Handle keyboard and mouse input
function handleInput() {
    const player = gameState.players[myId];
    if (!player) return;
    
    let targetAngle = player.angle;
    let moved = false;
    
    // Mouse control takes priority
    if (useMouseControl && mouseAngle !== null) {
        targetAngle = mouseAngle;
        moved = true;
    } else {
        // Keyboard controls
        if (keys['arrowleft'] || keys['a']) {
            targetAngle = player.angle - PADDLE_SPEED * 0.02;
            moved = true;
        }
        if (keys['arrowright'] || keys['d']) {
            targetAngle = player.angle + PADDLE_SPEED * 0.02;
            moved = true;
        }
        if (keys['arrowup'] || keys['w']) {
            // Move to opposite side
            targetAngle = player.angle + Math.PI;
            moved = true;
        }
        if (keys['arrowdown'] || keys['s']) {
            // Move to opposite side (other direction)
            targetAngle = player.angle - Math.PI;
            moved = true;
        }
    }
    
    // Smooth paddle movement
    if (moved) {
        // Normalize angles
        while (targetAngle > Math.PI) targetAngle -= Math.PI * 2;
        while (targetAngle < -Math.PI) targetAngle += Math.PI * 2;
        while (player.angle > Math.PI) player.angle -= Math.PI * 2;
        while (player.angle < -Math.PI) player.angle += Math.PI * 2;
        
        // Calculate shortest angular distance
        let diff = targetAngle - player.angle;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        
        // Apply movement
        if (useMouseControl) {
            player.angle = targetAngle; // Instant movement for mouse
        } else {
            player.angle += diff * 0.15; // Smooth movement for keyboard
        }
        
        // Broadcast paddle movement
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
            // Calculate bounce angle based on where ball hits paddle
            const paddleX = CENTER_X + Math.cos(player.angle) * PADDLE_DISTANCE;
            const paddleY = CENTER_Y + Math.sin(player.angle) * PADDLE_DISTANCE;
            
            // Get angle from paddle to ball
            const angleFromPaddle = Math.atan2(ball.y - paddleY, ball.x - paddleX);
            
            // Add some spin based on paddle movement
            const speed = BALL_SPEED * 1.05; // Slightly increase speed each hit
            ball.vx = Math.cos(angleFromPaddle) * speed;
            ball.vy = Math.sin(angleFromPaddle) * speed;
            
            // Move ball away from paddle to prevent multiple collisions
            const distance = PADDLE_DISTANCE + PADDLE_HEIGHT / 2 + ball.radius + 2;
            ball.x = CENTER_X + Math.cos(angleFromPaddle) * distance;
            ball.y = CENTER_Y + Math.sin(angleFromPaddle) * distance;
            
            // Increase player score
            player.score++;
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
    
    // Check if ball is near the paddle's angular position
    const ballAngle = Math.atan2(ball.y - CENTER_Y, ball.x - CENTER_X);
    let angleDiff = Math.abs(ballAngle - player.angle);
    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
    
    // Check if ball is at the right distance and angle
    const distFromCenter = Math.sqrt(Math.pow(ball.x - CENTER_X, 2) + Math.pow(ball.y - CENTER_Y, 2));
    const paddleAngleWidth = PADDLE_WIDTH / (2 * Math.PI * PADDLE_DISTANCE);
    
    return distFromCenter >= PADDLE_DISTANCE - PADDLE_HEIGHT &&
           distFromCenter <= PADDLE_DISTANCE + PADDLE_HEIGHT &&
           angleDiff < paddleAngleWidth;
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
    
    // Draw countdown if active
    if (gameState.countdown > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const countdownNumber = Math.ceil(gameState.countdown);
        ctx.fillText(countdownNumber, CENTER_X, CENTER_Y);
        
        // Draw "Get Ready!" text
        ctx.font = 'bold 24px Arial';
        ctx.fillText('Get Ready!', CENTER_X, CENTER_Y + 60);
    }
    
    // Draw paddles
    Object.values(gameState.players).forEach(player => {
        const x = CENTER_X + Math.cos(player.angle) * PADDLE_DISTANCE;
        const y = CENTER_Y + Math.sin(player.angle) * PADDLE_DISTANCE;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(player.angle + Math.PI / 2);
        ctx.fillStyle = player.color;
        ctx.fillRect(-PADDLE_WIDTH / 2, -PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
        
        // Draw player number on paddle
        ctx.fillStyle = '#000';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(player.number, 0, 0);
        
        ctx.restore();
        
        // Draw score near paddle
        if (gameState.gameStarted) {
            ctx.fillStyle = player.color;
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            const scoreX = CENTER_X + Math.cos(player.angle) * (PADDLE_DISTANCE - 50);
            const scoreY = CENTER_Y + Math.sin(player.angle) * (PADDLE_DISTANCE - 50);
            ctx.fillText(player.score || 0, scoreX, scoreY);
        }
    });
    
    // Draw ball (only if game started)
    if (gameState.gameStarted) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw controls hint
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Controls: WASD / Arrow Keys / Mouse', CENTER_X, CANVAS_SIZE - 20);
}

// Update status message
function updateStatus(message) {
    statusDiv.textContent = message;
}

// Back to lobby button
document.getElementById('backToLobby').addEventListener('click', () => {
    gameState.gameStarted = false;
    gameState.countdown = 0;
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
        countdown: 0,
        countdownStartTime: 0,
        scores: {}
    };
    
    // Reset UI
    document.getElementById('roomInfo').style.display = 'none';
    document.getElementById('startOptions').style.display = 'block';
    document.getElementById('joinCode').value = '';
    document.getElementById('roomCode').textContent = '';
    
    // Destroy peer connection
    if (peer) {
        peer.destroy();
        peer = null;
    }
    
    // Reset control state
    keys = {};
    mouseAngle = null;
    useMouseControl = false;
    
    isHost = false;
    myId = null;
    myPeerId = null;
    roomCode = null;
    playerNumber = null;
    
    updateStatus('Left room');
});
