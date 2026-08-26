import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

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

  emitRegressionTestCompleted(run: any) {
    this.server?.emit('regressionTest:completed', run);
  }

  emitSprintCreated(sprint: any) {
    this.server?.emit('sprint:created', sprint);
  }

  emitSprintUpdated(sprint: any) {
    this.server?.emit('sprint:updated', sprint);
  }

  emitSprintDeleted(sprintId: number) {
    this.server?.emit('sprint:deleted', { id: sprintId });
  }

  emitModuleCreated(module: any) {
    this.server?.emit('module:created', module);
  }

  emitModuleUpdated(module: any) {
    this.server?.emit('module:updated', module);
  }

  emitModuleDeleted(moduleId: number) {
    this.server?.emit('module:deleted', { id: moduleId });
  }
}
