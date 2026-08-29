import { io } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let socket;

// Returns a single shared socket connection for the whole app - created
// lazily so it only connects in the browser, never during server render.
// Sends the saved JWT so the server can put this connection in the right
// tenant's room - a connection with no/invalid token gets disconnected
// server-side rather than receiving anyone's real-time updates.
export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socket) {
    const token = localStorage.getItem('accessToken');
    socket = io(API_URL, { autoConnect: true, transports: ['websocket', 'polling'], auth: { token } });
  }
  return socket;
}

// Tears down the cached connection so the next getSocket() call opens a
// fresh one with whatever token is current - without this, logging out
// and back in as someone else (same tab, no full page reload) would keep
// reusing the previous person's connection, still joined to their
// tenant's room only.
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = undefined;
  }
}
