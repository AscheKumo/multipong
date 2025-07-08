// Game Constants
const CANVAS_SIZE = 600;
const CENTER_X = CANVAS_SIZE / 2;
const CENTER_Y = CANVAS_SIZE / 2;
const ARENA_RADIUS = 280;
const PADDLE_HEIGHT = 15;
const BALL_RADIUS = 8;
const PADDLE_SPEED = 0.05;
const MAX_PLAYERS = 6;
const COUNTDOWN_TIME = 3;
const GAP_SIZE = 20; // Gap size where ball can pass through

// Game Settings (can be modified by host)
let gameSettings = {
    pointsToWin: 10,
    ballSpeed: 5,
    paddleWidth: 80
};

// Game State
let gameState = {
    players: {},
    ball: {
        x: CENTER_X,
        y: CENTER_Y,
        vx: 0,
        vy: 0,
        radius: BALL_RADIUS,
        lastHitBy: null
    },
    gameStarted: false,
    countdown: 0,
    countdownStartTime: 0,
    scores: {},
    winner: null
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
let mouseX = null;
let mouseY = null;
let useMouseControl = false;

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('gameContainer');
const statusDiv = document.getElementById('status');
const scoreboard = document.getElementById('scoreboard');

// Initialize Canvas
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

// Player Colors
const PLAYER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];

// Setup input handlers
window.addEventListener('keydown', (e) => { 
    keys[e.key.toLowerCase()] = true;
    if (gameState.gameStarted) e.preventDefault();
});
window.addEventListener('keyup', (e) => { 
    keys[e.key.toLowerCase()] = false;
    if (gameState.gameStarted) e.preventDefault();
});

// Mouse controls
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    useMouseControl = true;
});

canvas.addEventListener('mouseleave', () => {
    useMouseControl = false;
});

// Settings change handlers (host only)
document.getElementById('pointsToWin').addEventListener('change', (e) => {
    if (isHost) {
        gameSettings.pointsToWin = parseInt(e.target.value);
        broadcastSettings();
    }
});

document.getElementById('ballSpeedSetting').addEventListener('change', (e) => {
    if (isHost) {
        gameSettings.ballSpeed = parseInt(e.target.value);
        broadcastSettings();
    }
});

document.getElementById('paddleSizeSetting').addEventListener('change', (e) => {
    if (isHost) {
        gameSettings.paddleWidth = parseInt(e.target.value);
        broadcastSettings();
    }
});

// Broadcast settings to all players
function broadcastSettings() {
    const message = {
        type: 'settingsUpdate',
        settings: gameSettings
    };
    
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            conn.send(message);
        }
    });
}

// Create a new room
document.getElementById('createRoom').addEventListener('click', () => {
    updateStatus('Creating room...');
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        myId = id;
        isHost = true;
        
        roomCode = id.slice(-6).toUpperCase();
        
        playerNumber = 1;
        addPlayer(myId, playerNumber);
        showGameRoom();
        
        console.log('Room created with peer ID:', id);
        updateStatus('Room created! Share the code with friends.');
        
        document.getElementById('roomCode').innerHTML = `
            <div>Room Code (short): <strong>${roomCode}</strong></div>
            <div style="font-size: 12px; margin-top: 10px;">
                Full ID: <code style="background: #222; padding: 5px; border-radius: 3px; word-break: break-all;">${id}</code>
            </div>
        `;
    });
    
    peer.on('connection', handleConnection);
    
    peer.on('error', (err) => {
        updateStatus(`Error: ${err.type} - ${err.message}`);
        console.error('PeerJS Error:', err);
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
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myPeerId = id;
        myId = id;
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
    const conn = peer.connect(hostId, {
        reliable: true
    });
    
    conn.on('open', () => {
        connections[hostId] = conn;
        roomCode = hostId.slice(-6).toUpperCase();
        setupConnectionHandlers(conn);
        updateStatus('Connected to room! Waiting for host...');
    });
    
    conn.on('error', (err) => {
        updateStatus('Failed to connect - check the code and try again');
        console.error('Connection error:', err);
    });
}

// Handle incoming connections
function handleConnection(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        
        if (isHost) {
            const usedNumbers = Object.values(gameState.players).map(p => p.number);
            let newPlayerNumber = 1;
            while (usedNumbers.includes(newPlayerNumber) && newPlayerNumber <= MAX_PLAYERS) {
                newPlayerNumber++;
            }
            
            if (newPlayerNumber <= MAX_PLAYERS) {
                addPlayer(conn.peer, newPlayerNumber);
                
                conn.send({
                    type: 'welcome',
                    playerNumber: newPlayerNumber,
                    gameState: gameState,
                    gameSettings: gameSettings,
                    isHost: false
                });
                
                updatePlayersList();
                broadcastGameState();
            } else {
                conn.send({ type: 'roomFull' });
                setTimeout(() => conn.close(), 100);
            }
        }
        
        setupConnectionHandlers(conn);
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
}

// Handle incoming messages
function handleMessage(data, senderId) {
    switch (data.type) {
        case 'welcome':
            playerNumber = data.playerNumber;
            gameState = data.gameState;
            gameSettings = data.gameSettings;
            isHost = data.isHost;
            addPlayer(myId, playerNumber);
            updatePlayersList();
            showGameRoom();
            updateStatus('Joined room successfully!');
            break;
            
        case 'gameState':
            const myPlayer = gameState.players[myId];
            gameState = data.gameState;
            if (myPlayer) {
                gameState.players[myId] = myPlayer;
            }
            updatePlayersList();
            break;
            
        case 'settingsUpdate':
            gameSettings = data.settings;
            updateSettingsDisplay();
            break;
            
        case 'paddleMove':
            if (gameState.players[senderId]) {
                gameState.players[senderId].paddlePosition = data.position;
            }
            break;
            
        case 'startCountdown':
            startCountdown();
            break;
            
        case 'ballUpdate':
            if (!isHost) {
                gameState.ball = data.ball;
                gameState.scores = data.scores;
                gameState.winner = data.winner;
            }
            break;
    }
}

// Update settings display
function updateSettingsDisplay() {
    document.getElementById('pointsToWin').value = gameSettings.pointsToWin;
    document.getElementById('ballSpeedSetting').value = gameSettings.ballSpeed;
    document.getElementById('paddleSizeSetting').value = gameSettings.paddleWidth;
}

// Show game room UI
function showGameRoom() {
    document.getElementById('startOptions').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'block';
    
    if (isHost) {
        document.getElementById('startGame').style.display = 'block';
        document.getElementById('gameSettings').style.display = 'block';
    } else {
        document.getElementById('gameSettings').style.display = 'none';
    }
    
    updatePlayersList();
}

// Add player to game
function addPlayer(id, number) {
    const playerCount = Object.keys(gameState.players).length + 1;
    const sectionAngle = (Math.PI * 2) / playerCount;
    const startAngle = (number - 1) * sectionAngle;
    
    gameState.players[id] = {
        id: id,
        number: number,
        startAngle: startAngle,
        endAngle: startAngle + sectionAngle,
        paddlePosition: 0.5, // 0 to 1, position within their section
        color: PLAYER_COLORS[number - 1],
        score: 0
    };
    
    // Recalculate all player sections
    recalculatePlayerSections();
    
    // Initialize score
    gameState.scores[id] = 0;
}

// Recalculate player sections when players join/leave
function recalculatePlayerSections() {
    const playerCount = Object.keys(gameState.players).length;
    const sectionAngle = (Math.PI * 2) / playerCount;
    
    Object.values(gameState.players).forEach((player, index) => {
        player.startAngle = index * sectionAngle - Math.PI / 2;
        player.endAngle = (index + 1) * sectionAngle - Math.PI / 2;
    });
}

// Update players list UI
function updatePlayersList() {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '<h3>Players:</h3>';
    
    Object.values(gameState.players).forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-slot active';
        div.textContent = `Player ${player.number}` + (player.id === myId ? ' (You)' : '');
        div.style.backgroundColor = player.color;
        playersList.appendChild(div);
    });
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
    
    // Reset scores
    Object.keys(gameState.scores).forEach(id => {
        gameState.scores[id] = 0;
    });
    
    updateScoreboard();
    gameLoop();
}

// Start the game
function startGame() {
    gameState.gameStarted = true;
    gameState.countdown = 0;
    gameState.winner = null;
    
    // Reset ball
    gameState.ball.x = CENTER_X;
    gameState.ball.y = CENTER_Y;
    const randomAngle = Math.random() * Math.PI * 2;
    gameState.ball.vx = Math.cos(randomAngle) * gameSettings.ballSpeed;
    gameState.ball.vy = Math.sin(randomAngle) * gameSettings.ballSpeed;
    gameState.ball.lastHitBy = null;
}

// Update scoreboard
function updateScoreboard() {
    let html = '<h3>Scores</h3>';
    Object.values(gameState.players).forEach(player => {
        const score = gameState.scores[player.id] || 0;
        html += `<div class="score-entry" style="color: ${player.color}">
            Player ${player.number}: ${score}/${gameSettings.pointsToWin}
        </div>`;
    });
    
    if (gameState.winner) {
        const winner = gameState.players[gameState.winner];
        html += `<h2 style="color: ${winner.color}">Player ${winner.number} Wins!</h2>`;
    }
    
    scoreboard.innerHTML = html;
}

// Game loop
function gameLoop() {
    if (!gameState.gameStarted && gameState.countdown <= 0 && !gameState.winner) return;
    
    // Update countdown
    if (gameState.countdown > 0) {
        const elapsed = (Date.now() - gameState.countdownStartTime) / 1000;
        gameState.countdown = Math.max(0, COUNTDOWN_TIME - elapsed);
        
        if (gameState.countdown <= 0 && !gameState.gameStarted) {
            startGame();
        }
    }
    
    // Handle input
    if (gameState.gameStarted && !gameState.winner) {
        handleInput();
    }
    
    // Update game state (only host updates ball)
    if (isHost && gameState.gameStarted && !gameState.winner) {
        updateBall();
        
        // Check for winner
        Object.entries(gameState.scores).forEach(([playerId, score]) => {
            if (score >= gameSettings.pointsToWin) {
                gameState.winner = playerId;
                gameState.gameStarted = false;
            }
        });
        
        // Broadcast game state
        Object.values(connections).forEach(conn => {
            if (conn.open) {
                conn.send({
                    type: 'ballUpdate',
                    ball: gameState.ball,
                    scores: gameState.scores,
                    winner: gameState.winner
                });
            }
        });
    }
    
    // Update scoreboard
    updateScoreboard();
    
    // Render game
    render();
    
    requestAnimationFrame(gameLoop);
}

// Handle keyboard and mouse input
function handleInput() {
    const player = gameState.players[myId];
    if (!player) return;
    
    let newPosition = player.paddlePosition;
    let moved = false;
    
    // Calculate the angular range of player's section
    const sectionAngle = player.endAngle - player.startAngle;
    
    if (useMouseControl && mouseX !== null && mouseY !== null) {
        // Convert mouse position to angle
        const mouseAngle = Math.atan2(mouseY - CENTER_Y, mouseX - CENTER_X);
        
        // Normalize angles
        let normalizedMouseAngle = mouseAngle;
        let normalizedStartAngle = player.startAngle;
        
        while (normalizedMouseAngle < normalizedStartAngle) {
            normalizedMouseAngle += Math.PI * 2;
        }
        
        // Calculate position within section (0 to 1)
        const angleWithinSection = normalizedMouseAngle - normalizedStartAngle;
        if (angleWithinSection >= 0 && angleWithinSection <= sectionAngle) {
            newPosition = angleWithinSection / sectionAngle;
            moved = true;
        }
    } else {
        // Keyboard controls
        if (keys['arrowleft'] || keys['a']) {
            newPosition = Math.max(0, player.paddlePosition - PADDLE_SPEED);
            moved = true;
        }
        if (keys['arrowright'] || keys['d']) {
            newPosition = Math.min(1, player.paddlePosition + PADDLE_SPEED);
            moved = true;
        }
    }
    
    // Update position and broadcast
    if (moved && newPosition !== player.paddlePosition) {
        player.paddlePosition = newPosition;
        
        Object.values(connections).forEach(conn => {
            if (conn.open) {
                conn.send({
                    type: 'paddleMove',
                    position: player.paddlePosition
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
    
    // Check distance from center
    const distFromCenter = Math.sqrt(Math.pow(ball.x - CENTER_X, 2) + Math.pow(ball.y - CENTER_Y, 2));
    
    // Check collision with paddles at arena edge
    if (distFromCenter >= ARENA_RADIUS - PADDLE_HEIGHT - ball.radius && 
        distFromCenter <= ARENA_RADIUS + ball.radius) {
        
        const ballAngle = Math.atan2(ball.y - CENTER_Y, ball.x - CENTER_X);
        
        // Check which player's section the ball is in
        let hitPaddle = false;
        Object.values(gameState.players).forEach(player => {
            if (isAngleInPlayerSection(ballAngle, player)) {
                // Check if paddle is at this position
                const paddleAngle = getPaddleAngle(player);
                const paddleArcLength = (gameSettings.paddleWidth / ARENA_RADIUS);
                
                let angleDiff = Math.abs(ballAngle - paddleAngle);
                if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                
                if (angleDiff < paddleArcLength / 2) {
                    // Hit paddle!
                    hitPaddle = true;
                    
                    // Calculate bounce angle
                    const normal = Math.atan2(ball.y - CENTER_Y, ball.x - CENTER_X);
                    const incoming = Math.atan2(ball.vy, ball.vx);
                    const bounceAngle = 2 * normal - incoming + Math.PI;
                    
                    // Add some spin based on where the ball hit the paddle
                    const hitOffset = (angleDiff / (paddleArcLength / 2));
                    const spin = hitOffset * 0.5;
                    
                    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) * 1.05;
                    ball.vx = Math.cos(bounceAngle + spin) * speed;
                    ball.vy = Math.sin(bounceAngle + spin) * speed;
                    
                    // Move ball away from paddle
                    const moveDistance = ARENA_RADIUS - PADDLE_HEIGHT - ball.radius - 2;
                    ball.x = CENTER_X + Math.cos(normal) * moveDistance;
                    ball.y = CENTER_Y + Math.sin(normal) * moveDistance;
                    
                    // Record who hit the ball
                    ball.lastHitBy = player.id;
                }
            }
        });
        
        // If ball didn't hit a paddle and is outside arena, someone scored
        if (!hitPaddle && distFromCenter > ARENA_RADIUS) {
            // Find which player's section the ball went through
            const ballAngle = Math.atan2(ball.y - CENTER_Y, ball.x - CENTER_X);
            
            Object.values(gameState.players).forEach(player => {
                if (isAngleInPlayerSection(ballAngle, player)) {
                    // This player got scored on
                    // Give point to last player who hit the ball
                    if (ball.lastHitBy && ball.lastHitBy !== player.id) {
                        gameState.scores[ball.lastHitBy]++;
                    }
                }
            });
            
            // Reset ball
            ball.x = CENTER_X;
            ball.y = CENTER_Y;
            const randomAngle = Math.random() * Math.PI * 2;
            ball.vx = Math.cos(randomAngle) * gameSettings.ballSpeed;
            ball.vy = Math.sin(randomAngle) * gameSettings.ballSpeed;
            ball.lastHitBy = null;
        }
    }
}

// Check if angle is in player's section
function isAngleInPlayerSection(angle, player) {
    // Normalize angles to 0-2π range
    let normalizedAngle = angle;
    let normalizedStart = player.startAngle;
    let normalizedEnd = player.endAngle;
    
    while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
    while (normalizedAngle > Math.PI * 2) normalizedAngle -= Math.PI * 2;
    while (normalizedStart < 0) normalizedStart += Math.PI * 2;
    while (normalizedEnd < 0) normalizedEnd += Math.PI * 2;
    
    if (normalizedEnd < normalizedStart) {
        // Section crosses 0
        return normalizedAngle >= normalizedStart || normalizedAngle <= normalizedEnd;
    } else {
        return normalizedAngle >= normalizedStart && normalizedAngle <= normalizedEnd;
    }
}

// Get paddle angle for a player
function getPaddleAngle(player) {
    const sectionAngle = player.endAngle - player.startAngle;
    const gapAngle = (GAP_SIZE / ARENA_RADIUS);
    const usableAngle = sectionAngle - gapAngle;
    return player.startAngle + gapAngle / 2 + (usableAngle * player.paddlePosition);
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
    
    // Draw player sections and paddles
    Object.values(gameState.players).forEach(player => {
        // Draw section boundaries
        ctx.strokeStyle = player.color + '33';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CENTER_X, CENTER_Y);
        ctx.lineTo(
            CENTER_X + Math.cos(player.startAngle) * ARENA_RADIUS,
            CENTER_Y + Math.sin(player.startAngle) * ARENA_RADIUS
        );
        ctx.stroke();
        
        // Draw paddle
        const paddleAngle = getPaddleAngle(player);
        const paddleArcLength = gameSettings.paddleWidth / ARENA_RADIUS;
        
        ctx.strokeStyle = player.color;
        ctx.lineWidth = PADDLE_HEIGHT;
        ctx.beginPath();
        ctx.arc(
            CENTER_X, 
            CENTER_Y, 
            ARENA_RADIUS, 
            paddleAngle - paddleArcLength / 2, 
            paddleAngle + paddleArcLength / 2
        );
        ctx.stroke();
        
        // Draw gaps at section boundaries
        const gapAngle = GAP_SIZE / ARENA_RADIUS;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = PADDLE_HEIGHT + 4;
        ctx.beginPath();
        ctx.arc(CENTER_X, CENTER_Y, ARENA_RADIUS, player.startAngle - gapAngle/2, player.startAngle + gapAngle/2);
        ctx.stroke();
    });
    
    // Draw countdown
    if (gameState.countdown > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const countdownNumber = Math.ceil(gameState.countdown);
        ctx.fillText(countdownNumber, CENTER_X, CENTER_Y);
        
        ctx.font = 'bold 24px Arial';
        ctx.fillText('Get Ready!', CENTER_X, CENTER_Y + 60);
    }
    
    // Draw ball
    if (gameState.gameStarted) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw trail
        if (gameState.ball.lastHitBy) {
            const player = gameState.players[gameState.ball.lastHitBy];
            if (player) {
                ctx.strokeStyle = player.color + '66';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(
                    gameState.ball.x - gameState.ball.vx * 2,
                    gameState.ball.y - gameState.ball.vy * 2
                );
                ctx.lineTo(gameState.ball.x, gameState.ball.y);
                ctx.stroke();
            }
        }
    }
    
    // Draw controls hint
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Controls: A/D, Arrow Keys, or Mouse', CENTER_X, CANVAS_SIZE - 20);
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
            vx: 0,
            vy: 0,
            radius: BALL_RADIUS,
            lastHitBy: null
        },
        gameStarted: false,
        countdown: 0,
        countdownStartTime: 0,
        scores: {},
        winner: null
    };
    
    // Reset settings
    gameSettings = {
        pointsToWin: 10,
        ballSpeed: 5,
        paddleWidth: 80
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
    mouseX = null;
    mouseY = null;
    useMouseControl = false;
    
    isHost = false;
    myId = null;
    myPeerId = null;
    roomCode = null;
    playerNumber = null;
    
    updateStatus('Left room');
});
