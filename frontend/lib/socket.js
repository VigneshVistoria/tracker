import { io } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let socket;

// Returns a single shared socket connection for the whole app - created
// lazily so it only connects in the browser, never during server render.
export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socket) {
    socket = io(API_URL, { autoConnect: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}
