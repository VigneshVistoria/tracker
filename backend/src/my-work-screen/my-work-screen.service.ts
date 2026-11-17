import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import {
  MY_WORK_SCREEN_AUDIT,
  MY_WORK_SCREEN_ROLES,
  MY_WORK_SCREEN_USER_ROLES,
  MyWorkScreenSettings,
  myWorkScreenOnFor,
  resolveMyWorkScreen,
} from './my-work-screen';
import { SaveMyWorkScreenDto } from './dto/my-work-screen.dto';

// See ./my-work-screen.ts.
@Injectable()
export class MyWorkScreenService {
  constructor(
    @InjectRepository(TeamSettings) private teamSettingsRepository: Repository<TeamSettings>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private auditLogService: AuditLogService,
  ) {}

  async settings(tenantId: number): Promise<MyWorkScreenSettings> {
    const row = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return resolveMyWorkScreen(row?.myWorkScreen);
  }

  // Any signed-in user: does my home show the new screen?
  async forMe(user: User, tenantId: number) {
    const on = MY_WORK_SCREEN_USER_ROLES.includes(user.role) && myWorkScreenOnFor(await this.settings(tenantId), user.id);
    return { on };
  }

  private assertEditor(user: User) {
    if (!MY_WORK_SCREEN_ROLES.includes(user.role)) throw new ForbiddenException('Only Admin or Program Manager can change the My work screen setting.');
  }

  private candidates(tenantId: number) {
    return this.usersRepository.find({ where: { tenantId, role: In(MY_WORK_SCREEN_USER_ROLES) }, order: { fullName: 'ASC', email: 'ASC' } });
  }

  async settingsPage(user: User, tenantId: number) {
    this.assertEditor(user);
    const [settings, users] = await Promise.all([this.settings(tenantId), this.candidates(tenantId)]);
    return { settings, users: users.map((u) => ({ id: u.id, name: u.fullName || u.email, email: u.email, role: u.role })) };
  }

  async save(dto: SaveMyWorkScreenDto, user: User, tenantId: number) {
    this.assertEditor(user);
    const ids = [...new Set(dto.pilotUserIds)];
    if (ids.length) {
      const allowed = new Set((await this.candidates(tenantId)).map((u) => u.id));
      if (ids.some((id) => !allowed.has(id))) throw new BadRequestException('Pilot users must be Developers, Designers or DevOps in this team.');
    }
    const next: MyWorkScreenSettings = { enabled: dto.enabled, pilotUserIds: ids };
    const before = await this.settings(tenantId);
    const existing = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    if (existing) {
      await this.teamSettingsRepository.update({ tenantId }, { myWorkScreen: next as any, updatedByUserId: user.id });
    } else {
      await this.teamSettingsRepository.save(this.teamSettingsRepository.create({ tenantId, myWorkScreen: next as any, updatedByUserId: user.id }));
    }
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: MY_WORK_SCREEN_AUDIT.UPDATED,
      tenantId,
      entityType: 'TeamSettings',
      entityId: tenantId,
      details: { before, after: next },
    });
    return this.settingsPage(user, tenantId);
  }
}
