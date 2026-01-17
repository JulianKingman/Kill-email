import { createServer } from 'http';
import { app } from './app';
import { setupWebSocket } from './websocket/handler';

const PORT = process.env.PORT || 3001;

const server = createServer(app);
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    KILL EMAIL SERVER                          ║
║                   "Hasta la vista, inbox"                     ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                     ║
║  WebSocket available on ws://localhost:${PORT}                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
