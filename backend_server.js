const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for commands and users (in production, use a database)
let commands = [];
let connectedClients = new Set();
let registeredUsers = new Map(); // Store all script users
let authorizedUsers = new Set(); // Store authorized admin users

// Optional API Key validation (can be disabled)
const API_KEY = process.env.API_KEY || null;
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === 'true';

// Helper function to validate API key
function validateApiKey(req) {
    if (!REQUIRE_API_KEY || !API_KEY) {
        return true; // No API key required
    }
    const apiKey = req.body.apiKey || req.query.apiKey;
    return apiKey === API_KEY;
}

// Helper function to validate coordinated command data
function validateCoordinatedCommand(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    
    const requiredFields = ['command'];
    for (const field of requiredFields) {
        if (!data[field]) {
            return false;
        }
    }
    
    return true;
}

// Helper function to sanitize command data
function sanitizeCommandData(data) {
    if (!data) return {};
    
    // Remove any potentially dangerous properties
    const safeData = {};
    const allowedKeys = ['command', 'args', 'targetAlts', 'mainUser', 'commandId', 'timestamp'];
    
    for (const key of allowedKeys) {
        if (data[key] !== undefined) {
            safeData[key] = data[key];
        }
    }
    
    return safeData;
}

// POST /api/command - Receive commands from script users
app.post('/api/command', (req, res) => {
    try {
        // Validate API key
        if (!validateApiKey(req)) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const { scriptId, playerId, playerName, command, args, timestamp } = req.body;

        // Validate required fields
        if (!scriptId || !playerId || !command) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Handle user registration
        if (command === 'register') {
            const userData = args;
            registeredUsers.set(playerId, {
                scriptId,
                playerId,
                playerName,
                isAuthorized: userData.isAuthorized,
                timestamp: Date.now()
            });
            
            if (userData.isAuthorized) {
                authorizedUsers.add(playerName);
            }
            
            console.log(`👤 User registered: ${playerName} (${playerId}) - ${userData.isAuthorized ? 'Admin' : 'Alt'}`);
            console.log(`📊 Total users: ${registeredUsers.size}, Admins: ${authorizedUsers.size}`);
            
            // Debug: print all registered users
            console.log('Registered users:', Array.from(registeredUsers.values()));
            
            return res.json({ 
                success: true, 
                message: 'User registered successfully',
                isAuthorized: userData.isAuthorized
            });
        }

        // Handle admin commands (from authorized users)
        if (authorizedUsers.has(playerName)) {
            console.log(`👑 Admin command: ${command} from ${playerName}`);
            
            // Create admin command object
            const commandObj = {
                id: Date.now().toString(),
                scriptId,
                playerId,
                playerName,
                command,
                args: args || {},
                timestamp,
                createdAt: new Date().toISOString(),
                isAdminCommand: true,
                targetAlts: "all" // Send to all non-admin users
            };

            // Store command
            commands.push(commandObj);

            // Debug: print all commands
            console.log('Current commands in queue:', commands.map(cmd => ({
                command: cmd.command,
                isAdminCommand: cmd.isAdminCommand,
                playerName: cmd.playerName,
                args: cmd.args,
                timestamp: cmd.timestamp
            })));

            console.log(`🎯 Admin command distributed: ${command} from ${playerName} to all alts`);

            res.json({ 
                success: true, 
                message: 'Admin command distributed',
                commandId: commandObj.id
            });
        } else {
            // Regular command from alt users
            const commandObj = {
                id: Date.now().toString(),
                scriptId,
                playerId,
                playerName,
                command,
                args: args || {},
                timestamp,
                createdAt: new Date().toISOString(),
                isAdminCommand: false
            };

            // Store command
            commands.push(commandObj);

            // Debug: print all commands
            console.log('Current commands in queue:', commands.map(cmd => ({
                command: cmd.command,
                isAdminCommand: cmd.isAdminCommand,
                playerName: cmd.playerName,
                args: cmd.args,
                timestamp: cmd.timestamp
            })));

            console.log(`📨 Alt command: ${command} from ${playerName} (${playerId})`);

            res.json({ 
                success: true, 
                message: 'Command received',
                commandId: commandObj.id
            });
        }

        // Keep only last 100 commands to prevent memory issues
        if (commands.length > 100) {
            commands = commands.slice(-100);
        }

    } catch (error) {
        console.error('Error processing command:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/commands - Retrieve commands for script users
app.get('/api/commands', (req, res) => {
    try {
        // Validate API key
        if (!validateApiKey(req)) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const { scriptId, playerId } = req.query;

        // Validate required fields
        if (!scriptId || !playerId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get current user info
        const currentUser = registeredUsers.get(playerId);
        const isCurrentUserAdmin = currentUser ? currentUser.isAuthorized : false;
        const currentUserName = currentUser ? currentUser.playerName : null;

        // Debug: print polling user
        console.log('Polling user:', currentUser);

        // Filter commands for this script and exclude commands from this player
        const filteredCommands = commands.filter(cmd => {
            if (cmd.scriptId !== scriptId || cmd.playerId === playerId) return false;
            if (cmd.timestamp < (Date.now() - 30000)) return false;

            // Admin commands: send to all non-admins, or to a specific alt if targeted
            if (cmd.isAdminCommand) {
                if (isCurrentUserAdmin) return false; // Don't send admin commands to admins
                if (cmd.args && cmd.args.target) {
                    // Targeted command: only send to the correct alt
                    return cmd.args.target === currentUserName || cmd.args.target === playerId;
                }
                // Otherwise, send to all alts
                return true;
            }

            // Alt commands: only send to admins
            if (!cmd.isAdminCommand && isCurrentUserAdmin) return true;

            return false;
        });

        // Debug: print filtered commands for this user
        console.log('Filtered commands for this user:', filteredCommands.map(cmd => ({
            command: cmd.command,
            isAdminCommand: cmd.isAdminCommand,
            playerName: cmd.playerName,
            args: cmd.args,
            timestamp: cmd.timestamp
        })));

        res.json({ 
            success: true, 
            commands: filteredCommands,
            count: filteredCommands.length
        });

    } catch (error) {
        console.error('Error retrieving commands:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/status - Health check
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online',
        timestamp: new Date().toISOString(),
        commandsCount: commands.length,
        connectedClients: connectedClients.size,
        registeredUsers: registeredUsers.size,
        authorizedUsers: authorizedUsers.size
    });
});

// GET /api/users - Get list of registered users
app.get('/api/users', (req, res) => {
    try {
        // Validate API key
        if (!validateApiKey(req)) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const users = [];
        for (const [playerId, userData] of registeredUsers) {
            users.push({
                playerId: userData.playerId,
                playerName: userData.playerName,
                isAuthorized: userData.isAuthorized,
                timestamp: userData.timestamp
            });
        }

        res.json({ 
            success: true, 
            users: users,
            totalUsers: users.length,
            adminUsers: users.filter(u => u.isAuthorized).length,
            altUsers: users.filter(u => !u.isAuthorized).length
        });

    } catch (error) {
        console.error('Error retrieving users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET / - Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Roblox Script Backend Server',
        version: '2.0.0',
        features: {
            'Coordinated Commands': 'Smart command distribution for alt management',
            'Formation Following': 'Line, circle, triangle, square formations',
            'Spread Positioning': 'Intelligent alt positioning around main user',
            'Targeted Commands': 'Send commands to specific alts or all alts',
            'Real-time Communication': 'Instant command distribution'
        },
        endpoints: {
            'POST /api/command': 'Send a command to the server',
            'GET /api/commands': 'Retrieve commands for script users',
            'GET /api/status': 'Server health check'
        },
        supportedCommands: [
            'bring', 'follow', 'say', 'attack', 'freeze', 'unfreeze',
            'kill', 'reset', 'speed', 'jump', 'sit', 'unsit',
            'invisible', 'visible', 'stop', 'godmode'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Roblox Script Backend Server v2.0.0`);
    console.log(`📍 Server running on port ${PORT}`);
    console.log(`🔗 Access at: http://localhost:${PORT}`);
    
    if (REQUIRE_API_KEY && API_KEY) {
        console.log(`🔐 API Key required: ${API_KEY}`);
    } else {
        console.log(`🔓 API Key: Disabled (no authentication required)`);
    }
    
    console.log(`📊 Features:`);
    console.log(`   • Coordinated Commands`);
    console.log(`   • Formation Following`);
    console.log(`   • Spread Positioning`);
    console.log(`   • Targeted Commands`);
    console.log(`   • Real-time Communication`);
    console.log(``);
    console.log(`🎮 Ready to receive commands from Roblox scripts!`);
});

// Cleanup old commands every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 300000; // 5 minutes
    commands = commands.filter(cmd => cmd.timestamp > cutoff);
            console.log(`🧹 Cleaned up old commands. Remaining: ${commands.length}`);
}, 300000);

module.exports = app; 
