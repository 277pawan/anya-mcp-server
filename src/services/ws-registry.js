export const globalClients = new Map();

export function addClient(sessionId, ws) {
  globalClients.set(sessionId, ws);
}

export function removeClient(sessionId) {
  globalClients.delete(sessionId);
}

export function getClient(sessionId) {
  return globalClients.get(sessionId);
}

export function broadcast(event, data) {
  for (const ws of globalClients.values()) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ event, ...data }));
    }
  }
}
