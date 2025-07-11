const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for commands (in production, use a database)
let commands = [];
let connectedClients = new Set();

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

        // Handle coordinated commands specially
        if (command === 'coordinated') {
            const coordinatedData = sanitizeCommandData(args);
            if (!validateCoordinatedCommand(coordinatedData)) {
                return res.status(400).json({ error: 'Invalid coordinated command data' });
            }

            // Create coordinated command object
            const commandObj = {
                id: Date.now().toString(),
                scriptId,
                playerId,
                playerName,
                command: 'coordinated',
                args: coordinatedData,
                timestamp,
                createdAt: new Date().toISOString(),
                isCoordinated: true
            };

            // Store command
            commands.push(commandObj);

            console.log(`🎯 Coordinated command received: ${coordinatedData.command} from ${playerName} (${playerId})`);
            console.log(`🎯 Target alts: ${coordinatedData.targetAlts || 'all'}`);
            console.log(`🎯 Command data:`, JSON.stringify(coordinatedData, null, 2));

            res.json({ 
                success: true, 
                message: 'Coordinated command received',
                commandId: commandObj.id
            });
        } else {
            // Regular command
            const commandObj = {
                id: Date.now().toString(),
                scriptId,
                playerId,
                playerName,
                command,
                args: args || {},
                timestamp,
                createdAt: new Date().toISOString(),
                isCoordinated: false
            };

            // Store command
            commands.push(commandObj);

            console.log(`📨 Command received: ${command} from ${playerName} (${playerId})`);

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

        // Filter commands for this script and exclude commands from this player
        const filteredCommands = commands.filter(cmd => {
            // Basic filtering
            if (cmd.scriptId !== scriptId || cmd.playerId === playerId) {
                return false;
            }
            
            // Only commands from last 30 seconds
            if (cmd.timestamp < (Date.now() - 30000)) {
                return false;
            }
            
            // For coordinated commands, check if this player should receive it
            if (cmd.isCoordinated && cmd.args.targetAlts) {
                const targetAlts = cmd.args.targetAlts;
                if (targetAlts !== 'all' && targetAlts !== playerId) {
                    return false; // This player is not targeted
                }
            }
            
            return true;
        });

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
        connectedClients: connectedClients.size
    });
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
