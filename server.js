const mineflayer = require('mineflayer');
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');
const session    = require('express-session');
const bodyParser = require('body-parser');
const bcrypt     = require('bcryptjs');
const minecraftProtocol = require('minecraft-protocol');

const app    = express();
const server = http.createServer(app);

// Configure socket.io with proper CORS settings
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const USERS_PATH = path.resolve(__dirname, 'users.json');

// Session configuration
const sessionMiddleware = session({
  secret: 'your-secret-key-' + Math.random(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
});

// Default configuration
let config = {
  accounts: [],
  selectedAccount: 0,
  host:               '',
  port:               25565,
  wiggleInterval:     30000,
  wiggleAmplitude:    0.1,
  chatPingEnabled:    false,
  chatPingInterval:   300000,
  chatPingMessage:    'afk',
  afkRetryInterval:   5000,
  autoReconnect: {
    enabled:          true,
    delay:            5000,
    onJoinCommand:    '',
    maxAttempts:      -1  // -1 means infinite
  },
  physics: {
    jumpEnabled:      true,
    sprintEnabled:    false,
    sneakEnabled:     false,
    gravity:          0.08,
    airBoost:         0.005,
    jumpBoost:        0.42,
    waterSpeed:       0.02,
    swimSpeed:        0.02,
    terminalVelocity: 3.92
  },
  movement: {
    autoJump:         true,
    autoJumpHeight:   1.0,
    maxSpeed:         4.317,
    walkSpeed:        4.317,
    sprintSpeed:      5.612,
    followRange:      0,
    movementType:     'none' // none, patrol, follow, random
  },
  pathfinding: {
    enabled:          false,
    avoidWater:       true,
    avoidLava:        true,
    range:            32,
    maxFallDistance:  3,
    canOpenDoors:     true,
    canBreakBlocks:   false
  },
  advanced: {
    viewDistance:     4,
    chatDelay:        0,
    reconnectDelay:   5000,
    autoRespawn:      true,
    hideErrors:       false,
    colorChat:        true
  }
};

// Users database
let users = {};

// Load existing config and users
try {
  if (fs.existsSync(CONFIG_PATH)) {
    Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
  }
  if (fs.existsSync(USERS_PATH)) {
    users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  } else {
    // Create default users
    users = {
      admin: bcrypt.hashSync('admin', 10),
      user1: bcrypt.hashSync('password1', 10),
      user2: bcrypt.hashSync('password2', 10)
    };
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  }
} catch (err) {
  console.error('Error loading config/users:', err);
}

let lastAFKCommand = null;
let bot = null;
let timers = [];
let isConnecting = false;
let pendingMsaAuth = null;
let serverPing = null;
let pingInProgress = false;
let lastPingError = null;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionMiddleware);

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Socket authentication
io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.user) {
    next();
  } else {
    next(new Error('Authentication required'));
  }
});

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    return res.redirect('/login');
  }
}

// Serve static files
app.use('/static', express.static('public'));

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (users[username] && bcrypt.compareSync(password, users[username])) {
    req.session.user = username;
    res.redirect('/');
  } else {
    res.status(401).send('Invalid credentials');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Main dashboard (protected)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function emitStatus() {
  const isConnected = bot && bot.entity ? true : false;
  const currentAccount = config.accounts[config.selectedAccount];
  
  io.emit('status', {
    accounts:           config.accounts.map(acc => ({ 
      username: acc.username, 
      auth: acc.auth 
    })),
    selectedAccount:    config.selectedAccount,
    connected:          isConnected,
    username:           isConnected ? bot.username : (currentAccount ? currentAccount.username : '—'),
    health:             isConnected && Number.isFinite(bot.health) ? bot.health : null,
    food:               isConnected && Number.isFinite(bot.food) ? bot.food : null,
    ping:               isConnected ? serverPing : null,
    host:               config.host,
    port:               config.port,
    wiggleInterval:     config.wiggleInterval,
    wiggleAmplitude:    config.wiggleAmplitude,
    chatPingEnabled:    config.chatPingEnabled,
    chatPingInterval:   config.chatPingInterval,
    chatPingMessage:    config.chatPingMessage,
    afkRetryInterval:   config.afkRetryInterval,
    autoReconnect:      config.autoReconnect,
    physics:            config.physics,
    movement:           config.movement,
    pathfinding:        config.pathfinding,
    advanced:           config.advanced
  });
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    log('⚙️ Settings saved');
  } catch (err) {
    log(`❌ Could not save config: ${err.message}`);
  }
}

// Minecraft color code to HTML color conversion
const MINECRAFT_COLORS = {
  '0': '#000000', // Black
  '1': '#0000AA', // Dark Blue
  '2': '#00AA00', // Dark Green
  '3': '#00AAAA', // Dark Aqua
  '4': '#AA0000', // Dark Red
  '5': '#AA00AA', // Dark Purple
  '6': '#FFAA00', // Gold
  '7': '#AAAAAA', // Gray
  '8': '#555555', // Dark Gray
  '9': '#5555FF', // Blue
  'a': '#55FF55', // Green
  'b': '#55FFFF', // Aqua
  'c': '#FF5555', // Red
  'd': '#FF55FF', // Light Purple
  'e': '#FFFF55', // Yellow
  'f': '#FFFFFF', // White
  'r': 'reset'
};

const MINECRAFT_FORMATS = {
  'l': 'bold',
  'm': 'strikethrough',
  'n': 'underline',
  'o': 'italic',
  'k': 'obfuscated'
};

function parseMinecraftCodes(text) {
  let result = [];
  let currentStyle = {
    color: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    obfuscated: false
  };
  
  // Replace § with & for processing (some systems may not handle § correctly)
  text = text.replace(/§/g, '&');
  
  let parts = text.split(/(&[0-9a-fklmnor])/);
  let currentText = '';
  
  for (let part of parts) {
    if (part.match(/^&[0-9a-fklmnor]$/)) {
      if (currentText) {
        result.push({
          text: currentText,
          style: {...currentStyle}
        });
        currentText = '';
      }
      
      const code = part[1];
      if (MINECRAFT_COLORS[code]) {
        if (code === 'r') {
          currentStyle = {
            color: null,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            obfuscated: false
          };
        } else {
          currentStyle.color = MINECRAFT_COLORS[code];
        }
      } else if (MINECRAFT_FORMATS[code]) {
        currentStyle[MINECRAFT_FORMATS[code]] = true;
      }
    } else {
      currentText += part;
    }
  }
  
  if (currentText) {
    result.push({
      text: currentText,
      style: {...currentStyle}
    });
  }
  
  return result;
}

function log(msg) {
  // Parse color codes if color chat is enabled
  if (config.advanced.colorChat) {
    const parsed = parseMinecraftCodes(msg);
    io.emit('colorLog', parsed);
  } else {
    io.emit('log', msg);
  }
  console.log(msg);
}

function clearTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

function refreshServerPing() {
  if (!bot || !bot.entity || pingInProgress) return;

  const activeBot = bot;
  pingInProgress = true;
  minecraftProtocol.ping({
    host: config.host,
    port: config.port,
    closeTimeout: 5000,
    noPongTimeout: 3000
  }).then(response => {
    if (bot !== activeBot) return;
    serverPing = Number.isFinite(response.latency) ? response.latency : null;
    lastPingError = null;
    emitStatus();
  }).catch(err => {
    if (bot !== activeBot) return;
    serverPing = null;
    if (lastPingError !== err.message) {
      lastPingError = err.message;
      log(`⚠️ Server ping unavailable: ${err.message}`);
    }
    emitStatus();
  }).finally(() => {
    pingInProgress = false;
  });
}

let reconnectAttempts = 0;

function startBot(forceRestart = false) {
  if (isConnecting && !forceRestart) return;
  if (forceRestart) {
    if (bot) {
      bot.removeAllListeners();
      bot.end();
      bot = null;
    }
    isConnecting = false;
    pendingMsaAuth = null;
  }
  serverPing = null;
  if (bot) {
    bot.end();
    bot.removeAllListeners();
    bot = null;
  }
  clearTimers();

  if (config.accounts.length === 0) {
    log('⚠️ No accounts configured. Please add an account first.');
    return;
  }
  if (!config.host) {
    log('⚠️ Enter the Minecraft server address in dashboard settings before connecting.');
    return;
  }

  const account = config.accounts[config.selectedAccount] || config.accounts[0];
  isConnecting = true;
  
  try {
    bot = mineflayer.createBot({
      host:     config.host,
      port:     config.port,
      auth:     account.auth,
      username: account.username,
      version:  '1.19.4', // Auto-detect version
      checkTimeoutInterval: 60 * 1000,
      physicsEnabled: config.physics.jumpEnabled || config.physics.sprintEnabled || config.physics.sneakEnabled,
      viewDistance: config.advanced.viewDistance,
      hideErrors: config.advanced.hideErrors,
      onMsaCode: authInfo => {
        const codeLifetime = Number(authInfo.expires_in);
        pendingMsaAuth = {
          account: account.username,
          url: authInfo.verification_uri_complete || authInfo.verification_uri,
          authCode: authInfo.user_code,
          message: authInfo.message,
          expiresAt: Date.now() + (Number.isFinite(codeLifetime) && codeLifetime > 0 ? codeLifetime : 900) * 1000
        };
        io.emit('authRequired', pendingMsaAuth);
      }
    });

    // Patch chat to use the correct packet
    bot.chat = (message) => {
      if (bot._client) {
        bot._client.write('chat_message', { message });
      }
    };

    // Configure physics and movement
    bot.once('inject_allowed', () => {
      if (bot.physics) {
        bot.physics.gravity = config.physics.gravity;
        bot.physics.jumpBoost = config.physics.jumpBoost;
        bot.physics.waterSpeed = config.physics.waterSpeed;
        bot.physics.autoJump = config.movement.autoJump;
        bot.physics.autoJumpHeight = config.movement.autoJumpHeight;
      }
    });

    bot.once('spawn', () => {
      isConnecting = false;
      reconnectAttempts = 0; // Reset attempts on successful connection
      pendingMsaAuth = null;
      
      log(`✔️ §aLogged in as §e${bot.username}`);
      emitStatus();
      refreshServerPing();
      timers.push(setInterval(refreshServerPing, 15000));

      // Execute on-join command if configured
      if (config.autoReconnect.onJoinCommand) {
        const commands = config.autoReconnect.onJoinCommand.split(';');
        let delay = 1000;
        commands.forEach(cmd => {
          cmd = cmd.trim();
          if (cmd) {
            setTimeout(() => {
              bot.chat(cmd);
              log(`§6[AUTO] §f${cmd}`);
            }, delay);
            delay += 500; // Add delay between commands
          }
        });
      }

      // Apply physics settings
      if (config.physics.jumpEnabled) {
        bot.setControlState('jump', false);
      }
      if (config.physics.sprintEnabled) {
        bot.setControlState('sprint', true);
      }
      if (config.physics.sneakEnabled) {
        bot.setControlState('sneak', true);
      }

      // Wiggle routine
      if (config.wiggleInterval > 0) {
        timers.push(setInterval(() => {
          if (bot.entity) {
            bot.look(bot.entity.yaw + config.wiggleAmplitude, bot.entity.pitch, false);
          }
        }, config.wiggleInterval));
      }

      // Chat ping routine
      if (config.chatPingEnabled && config.chatPingInterval > 0) {
        timers.push(setInterval(() => {
          if (bot && bot.chat) {
            bot.chat(config.chatPingMessage);
          }
        }, config.chatPingInterval));
      }

      // Movement type routines
      if (config.movement.movementType === 'patrol') {
        // Implement patrol behavior
        timers.push(setInterval(() => {
          if (bot.entity) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 5 + Math.random() * 5;
            const dx = Math.cos(angle) * distance;
            const dz = Math.sin(angle) * distance;
            const pos = bot.entity.position;
            bot.pathfinder?.goto(pos.offset(dx, 0, dz));
          }
        }, 10000));
      } else if (config.movement.movementType === 'random') {
        // Implement random walk
        timers.push(setInterval(() => {
          if (bot.entity) {
            bot.setControlState('forward', Math.random() > 0.5);
            bot.setControlState('left', Math.random() > 0.7);
            bot.setControlState('right', Math.random() > 0.7);
          }
        }, 2000));
      }

      // Auto respawn
      if (config.advanced.autoRespawn) {
        bot.on('death', () => {
          log('§c💀 Bot died, respawning...');
          setTimeout(() => {
            if (bot && !bot.entity) {
              bot.respawn();
            }
          }, 1000);
        });
      }
    });

    bot.on('health', emitStatus);

    bot.on('message', msg => {
      // Parse chat message with color codes
      const text = msg.toString();
      log(`[CHAT] ${text}`);
      
      if (text.toLowerCase().includes('region is full')) {
        log(`§e⚠️ Region full, retrying in ${config.afkRetryInterval}ms`);
        timers.push(setTimeout(() => {
          if (lastAFKCommand && bot && bot.chat) {
            bot.chat(lastAFKCommand);
          }
        }, config.afkRetryInterval));
      }
    });

    bot.on('kicked', reason => {
      log(`§c❌ Kicked: ${JSON.stringify(reason)}`);
      emitStatus();
      isConnecting = false;
      handleDisconnect();
    });

    bot.on('end', () => {
      log('§e⚠️ Disconnected');
      emitStatus();
      isConnecting = false;
      handleDisconnect();
    });

    bot.on('error', err => {
      log(`§c⚠️ Error: ${err.message}`);
      console.error(err);
      isConnecting = false;
      handleDisconnect();
    });
  } catch (err) {
    log(`§c❌ Failed to create bot: ${err.message}`);
    isConnecting = false;
    handleDisconnect();
  }
}

function handleDisconnect() {
  if (config.autoReconnect.enabled) {
    reconnectAttempts++;
    
    if (config.autoReconnect.maxAttempts === -1 || reconnectAttempts <= config.autoReconnect.maxAttempts) {
      log(`§6⟳ Auto reconnect attempt ${reconnectAttempts}${config.autoReconnect.maxAttempts === -1 ? '' : '/' + config.autoReconnect.maxAttempts} in ${config.autoReconnect.delay}ms...`);
      timers.push(setTimeout(startBot, config.autoReconnect.delay));
    } else {
      log(`§c❌ Max reconnect attempts (${config.autoReconnect.maxAttempts}) reached. Giving up.`);
    }
  }
}

io.on('connection', socket => {
  emitStatus();
  if (pendingMsaAuth && pendingMsaAuth.expiresAt > Date.now()) {
    socket.emit('authRequired', pendingMsaAuth);
  }

  socket.on('addAccount', async data => {
    try {
      const username = typeof data?.username === 'string' ? data.username.trim() : '';
      if (!username) {
        socket.emit('log', '❌ Enter a Microsoft account email to add it.');
        return;
      }
      if (config.accounts.some(account => account.username.toLowerCase() === username.toLowerCase())) {
        socket.emit('log', `⚠️ Account ${username} is already registered.`);
        return;
      }

      config.accounts.push({
        username,
        auth: 'microsoft'
      });
      config.selectedAccount = config.accounts.length - 1;
      saveConfig();
      emitStatus();
      log(`✔️ Account ${username} added. Complete Microsoft sign-in in the browser to authenticate.`);
      startBot();
    } catch (err) {
      log(`❌ Failed to add account: ${err.message}`);
    }
  });

  socket.on('removeAccount', index => {
    if (index >= 0 && index < config.accounts.length) {
      const removed = config.accounts.splice(index, 1)[0];
      if (config.selectedAccount >= config.accounts.length) {
        config.selectedAccount = Math.max(0, config.accounts.length - 1);
      }
      saveConfig();
      emitStatus();
      log(`✔️ Removed account ${removed.username}`);
    }
  });

  socket.on('editAccount', data => {
    const index = Number(data?.index);
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    if (!Number.isInteger(index) || index < 0 || index >= config.accounts.length || !username) {
      socket.emit('log', '❌ Select an account and enter a valid Microsoft account email.');
      return;
    }
    if (config.accounts.some((account, accountIndex) =>
      accountIndex !== index && account.username.toLowerCase() === username.toLowerCase())) {
      socket.emit('log', `⚠️ Account ${username} is already registered.`);
      return;
    }

    const account = config.accounts[index];
    const previousUsername = account.username;
    if (previousUsername === username) return;
    account.username = username;
    saveConfig();
    emitStatus();
    log(`✔️ Updated account ${previousUsername} to ${username}. Microsoft sign-in may be required again.`);
    if (index === config.selectedAccount) startBot(true);
  });

  socket.on('setSettings', data => {
    // Basic settings
    config.selectedAccount  = parseInt(data.selectedAccount, 10);
    config.host             = data.host;
    config.port             = parseInt(data.port, 10);
    config.wiggleInterval   = parseInt(data.wiggleInterval, 10);
    config.wiggleAmplitude  = parseFloat(data.wiggleAmplitude);
    config.chatPingEnabled  = data.chatPingEnabled === 'on';
    config.chatPingInterval = parseInt(data.chatPingInterval, 10);
    config.chatPingMessage  = data.chatPingMessage;
    config.afkRetryInterval = parseInt(data.afkRetryInterval, 10);
    
    // Auto reconnect settings
    config.autoReconnect.enabled       = data.autoReconnectEnabled === 'on';
    config.autoReconnect.delay         = parseInt(data.autoReconnectDelay, 10);
    config.autoReconnect.onJoinCommand = data.autoReconnectOnJoinCommand;
    config.autoReconnect.maxAttempts   = parseInt(data.autoReconnectMaxAttempts, 10);
    
    // Physics settings
    config.physics.jumpEnabled     = data.physicsJumpEnabled === 'on';
    config.physics.sprintEnabled   = data.physicsSprintEnabled === 'on';
    config.physics.sneakEnabled    = data.physicsSneakEnabled === 'on';
    config.physics.gravity         = parseFloat(data.physicsGravity);
    config.physics.jumpBoost       = parseFloat(data.physicsJumpBoost);
    config.physics.waterSpeed      = parseFloat(data.physicsWaterSpeed);
    
    // Movement settings
    config.movement.autoJump       = data.movementAutoJump === 'on';
    config.movement.autoJumpHeight = parseFloat(data.movementAutoJumpHeight);
    config.movement.walkSpeed      = parseFloat(data.movementWalkSpeed);
    config.movement.sprintSpeed    = parseFloat(data.movementSprintSpeed);
    config.movement.movementType   = data.movementType;
    
    // Pathfinding settings
    config.pathfinding.enabled     = data.pathfindingEnabled === 'on';
    config.pathfinding.avoidWater  = data.pathfindingAvoidWater === 'on';
    config.pathfinding.avoidLava   = data.pathfindingAvoidLava === 'on';
    config.pathfinding.canOpenDoors = data.pathfindingCanOpenDoors === 'on';
    
    // Advanced settings
    config.advanced.autoRespawn    = data.advancedAutoRespawn === 'on';
    config.advanced.viewDistance   = parseInt(data.advancedViewDistance, 10);
    config.advanced.reconnectDelay = parseInt(data.advancedReconnectDelay, 10);
    config.advanced.colorChat      = data.advancedColorChat === 'on';

    saveConfig();
    log('⚙️ Restarting bot with new settings…');
    startBot();
  });

  socket.on('sendChat', text => {
    if (bot && bot.chat) {
      if (text.trim().startsWith('/afk')) {
        lastAFKCommand = text.trim();
      }
      bot.chat(text);
      log(`[YOU] ${text}`);
    }
  });
});

// User management page (only for admin)
app.get('/manage-users', requireAuth, (req, res) => {
  if (req.session.user !== 'admin') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'manage-users.html'));
});

// User management (protected)
app.get('/users', requireAuth, (req, res) => {
  // Only admin can manage users
  if (req.session.user !== 'admin') {
    return res.status(403).send('Admin access required');
  }
  res.json(Object.keys(users));
});

app.post('/users', requireAuth, (req, res) => {
  if (req.session.user !== 'admin') {
    return res.status(403).send('Admin access required');
  }
  
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password required');
  }
  
  if (users[username]) {
    return res.status(400).send('User already exists');
  }
  
  users[username] = bcrypt.hashSync(password, 10);
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  res.json({ success: true });
});

app.delete('/users/:username', requireAuth, (req, res) => {
  if (req.session.user !== 'admin') {
    return res.status(403).send('Admin access required');
  }
  
  const { username } = req.params;
  if (username === 'admin') {
    return res.status(400).send('Cannot delete admin user');
  }
  
  if (users[username]) {
    delete users[username];
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
    res.json({ success: true });
  } else {
    res.status(404).send('User not found');
  }
});

const WEB_PORT = 3000;
server.listen(WEB_PORT, () => {
  console.log(`UI at http://localhost:${WEB_PORT}`);
  console.log('Default users:');
  console.log('  admin / admin (administrator)');
  console.log('  user1 / password1');
  console.log('  user2 / password2');
  console.log('\nLogin to manage users and start the bot.');
  startBot();
});
