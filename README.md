# Minecraft AFK System

![Minecraft](https://img.shields.io/badge/Game-Minecraft-brightgreen)
![Status](https://img.shields.io/badge/Status-Active-success)

An AFK system for Minecraft with a user-friendly web interface. This tool helps you stay AFK in Minecraft servers with various automation features.

## Features

- 🖥️ **Web-Based Dashboard** - Control your AFK bot through an intuitive browser interface
- 👤 **Multiple Account Support** - Add and switch between Microsoft and Mojang accounts
- 🤖 **Anti-AFK Mechanisms**:
  - Automatic head movement (wiggle) to prevent AFK detection
  - Customizable chat pings to stay active on servers
- 🔄 **Auto-Reconnection** - Automatically reconnects if kicked from the server
- 💬 **Chat Integration** - Send and receive chat messages through the dashboard
- ⚙️ **Customizable Settings**:
  - Wiggle interval and amplitude adjustments
  - Chat ping intervals and messages
  - Server connection parameters

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or newer recommended)
- A valid Minecraft account (Microsoft or Mojang)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/GustyCube/minecraft-afk.git
   cd minecraft-afk
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Check the server code and start the application:
   ```bash
   npm run build
   npm run start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Configuration

The application creates a `config.json` file that stores your settings between sessions. Initial default configuration:

```json
{
  "accounts": [
    {
      "username": "you@example.com",
      "auth": "microsoft",
      "proxy": {
        "enabled": false,
        "host": "",
        "port": 1080,
        "type": "socks5",
        "username": "",
        "password": ""
      }
    }
  ],
  "selectedAccount": 0,
  "host": "",
  "port": 25565,
  "wiggleInterval": 30000,
  "wiggleAmplitude": 0.1,
  "chatPingEnabled": false,
  "chatPingInterval": 300000,
  "chatPingMessage": "afk",
  "afkRetryInterval": 5000
}
```

## Usage

1. **Add Accounts**:
   - Enter your Microsoft account email and click "Add New Account"
   - Open the Microsoft sign-in page shown in the dashboard and enter its one-time code
   - The bot completes authentication automatically; tokens are cached by Mineflayer for future connections
   - Use "Edit Email" on a registered account to change its email; the active account may require Microsoft sign-in again

2. **Configure Settings**:
   - Set server address and port
   - Adjust wiggle interval (in milliseconds) and amplitude
   - Enable/disable chat ping and set message
   - Click "Save & Restart" to apply changes

3. **AFK Commands**:
   - Send commands via the chat input
   - The system recognizes `/afk` commands for re-sending after disconnections
   - The dashboard shows live health, food, and available ping data alongside chat and system logs

`npm run build` checks the Node.js server file for syntax errors. The project does not require a separate compilation step.

## Dependencies

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) - Minecraft bot library
- [Express](https://expressjs.com/) - Web server framework
- [Socket.io](https://socket.io/) - Real-time communication

## License

This project is available as open source under the terms of the MIT License.

## Author

Created by [GustyCube](https://github.com/GustyCube)

---

**Note:** Using automated clients on Minecraft servers may be against some server rules. Use responsibly and only on servers where such tools are permitted.

**Last updated:** 2025-04-21
