import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';
import { Project } from '../projects/project.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EventsGateway } from '../events/events.gateway';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    private eventsGateway: EventsGateway,
  ) {}

  // Global-by-design - the one remaining caller (TeamsMessageConverterService,
  // matching a Teams @mention to a local account) isn't tenant-scoped yet.
  // That's Phase C's job (general query scoping); until then this can
  // technically match the wrong tenant's user if two tenants share an
  // email, which is why the auth flow below uses findByEmailAndTenant
  // instead of this.
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  findByEmailAndTenant(email: string, tenantId: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email, tenantId } });
  }

  findById(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id }, relations: ['projects'] });
  }

  count(): Promise<number> {
    return this.usersRepository.count();
  }

  countByTenant(tenantId: number): Promise<number> {
    return this.usersRepository.count({ where: { tenantId } });
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find({ relations: ['projects'], order: { createdAt: 'DESC' } });
  }

  // Used by the plain registration flow (no role/projects choice there).
  async create(email: string, passwordHash: string, tenantId: number, fullName?: string, role: UserRole = UserRole.DEVELOPER): Promise<User> {
    const user = this.usersRepository.create({ email, passwordHash, fullName, role, tenantId });
    return this.usersRepository.save(user);
  }

  // Used by an admin via the User Management page - can set role and
  // projects. tenantId is always the calling admin's own tenant, never
  // client-supplied - an admin can only ever create users in their tenant.
  async adminCreate(dto: CreateUserDto, tenantId: number): Promise<User> {
    const existing = await this.findByEmailAndTenant(dto.email, tenantId);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const projects = await this.resolveProjects(dto.projectIds);

    const user = this.usersRepository.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role || UserRole.DEVELOPER,
      projects,
      tenantId,
    });

    return this.usersRepository.save(user).then((saved) => {
      this.eventsGateway.emitUserCreated({ id: saved.id, email: saved.email, fullName: saved.fullName, role: saved.role });
      return saved;
    });
  }

  async update(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    if (dto.projectIds !== undefined) user.projects = await this.resolveProjects(dto.projectIds);

    return this.usersRepository.save(user);
  }

  // Program Manager is a normal role now (ReleaseBot, 2026-08-22) - more
  // than one person can hold it, so this returns all of them rather than
  // a single singleton like the old isProgramManager flag did.
  findProgramManagers(): Promise<User[]> {
    return this.usersRepository.find({ where: { role: UserRole.PROGRAM_MANAGER } });
  }

  // Generic role lookup - used by ReleaseBot Phase 1's notifications
  // (QA on a Leadership Request ticket, Administrators on a blocked
  // creation attempt) and expected to grow more callers as later phases
  // add more role-targeted notifications.
  findByRole(role: UserRole): Promise<User[]> {
    return this.usersRepository.find({ where: { role } });
  }

  private async resolveProjects(projectIds?: number[]): Promise<Project[]> {
    if (!projectIds || projectIds.length === 0) return [];
    return this.projectsRepository.find({ where: { id: In(projectIds) } });
  }
}
