import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

function tenantRoom(tenantId: number): string {
  return `tenant:${tenantId}`;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private jwtService: JwtService) {}

  // Every real-time payload below carries data belonging to exactly one
  // tenant, so a client must prove which tenant it belongs to before it
  // can receive anything - joins a Socket.IO room keyed by tenantId
  // (resolved from the same JWT used for REST auth) instead of the old
  // global broadcast, which would otherwise leak live updates across
  // tenants. Connections that don't present a valid token are dropped.
  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) {
      this.logger.warn(`Client ${client.id} connected with no auth token - disconnecting.`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token);
      client.join(tenantRoom(payload.tenantId));
      this.logger.log(`Client connected: ${client.id} (tenant ${payload.tenantId})`);
    } catch {
      this.logger.warn(`Client ${client.id} connected with an invalid/expired token - disconnecting.`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitIssueCreated(issue: any) {
    this.server?.to(tenantRoom(issue.tenantId)).emit('issue:created', issue);
  }

  emitIssueUpdated(issue: any) {
    this.server?.to(tenantRoom(issue.tenantId)).emit('issue:updated', issue);
  }

  emitProjectCreated(project: any) {
    this.server?.to(tenantRoom(project.tenantId)).emit('project:created', project);
  }

  emitUserCreated(user: any) {
    this.server?.to(tenantRoom(user.tenantId)).emit('user:created', user);
  }

  emitDailyUpdateCreated(update: any) {
    this.server?.to(tenantRoom(update.tenantId)).emit('dailyUpdate:created', update);
  }

  emitRegressionTestCompleted(run: any) {
    this.server?.to(tenantRoom(run.tenantId)).emit('regressionTest:completed', run);
  }

  emitSprintCreated(sprint: any) {
    this.server?.to(tenantRoom(sprint.tenantId)).emit('sprint:created', sprint);
  }

  emitSprintUpdated(sprint: any) {
    this.server?.to(tenantRoom(sprint.tenantId)).emit('sprint:updated', sprint);
  }

  emitSprintDeleted(sprintId: number, tenantId: number) {
    this.server?.to(tenantRoom(tenantId)).emit('sprint:deleted', { id: sprintId });
  }

  emitModuleCreated(module: any) {
    this.server?.to(tenantRoom(module.tenantId)).emit('module:created', module);
  }

  emitModuleUpdated(module: any) {
    this.server?.to(tenantRoom(module.tenantId)).emit('module:updated', module);
  }

  emitModuleDeleted(moduleId: number, tenantId: number) {
    this.server?.to(tenantRoom(tenantId)).emit('module:deleted', { id: moduleId });
  }
}
