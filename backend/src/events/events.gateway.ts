import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

// Broadcasts app events (issue created/updated, project created) to every
// connected browser tab, so lists update live without anyone refreshing.
// Kept intentionally simple: no per-user rooms, no auth on the socket
// itself - fine for this app's scale, but note this means anyone with a
// live connection receives all broadcasts (the UI still only *shows* what
// each user is allowed to see, via the normal REST permission checks).
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitIssueCreated(issue: any) {
    this.server?.emit('issue:created', issue);
  }

  emitIssueUpdated(issue: any) {
    this.server?.emit('issue:updated', issue);
  }

  emitProjectCreated(project: any) {
    this.server?.emit('project:created', project);
  }

  emitUserCreated(user: any) {
    this.server?.emit('user:created', user);
  }

  emitDailyUpdateCreated(update: any) {
    this.server?.emit('dailyUpdate:created', update);
  }
}
