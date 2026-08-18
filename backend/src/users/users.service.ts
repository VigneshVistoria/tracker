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

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  findById(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id }, relations: ['projects'] });
  }

  count(): Promise<number> {
    return this.usersRepository.count();
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find({ relations: ['projects'], order: { createdAt: 'DESC' } });
  }

  // Used by the plain registration flow (no role/projects choice there).
  async create(email: string, passwordHash: string, fullName?: string, role: UserRole = UserRole.DEVELOPER): Promise<User> {
    const user = this.usersRepository.create({ email, passwordHash, fullName, role });
    return this.usersRepository.save(user);
  }

  // Used by an admin via the User Management page - can set role and projects.
  async adminCreate(dto: CreateUserDto): Promise<User> {
    const existing = await this.findByEmail(dto.email);
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

    if (dto.isProgramManager !== undefined) {
      if (dto.isProgramManager) {
        // Only one Program Manager at a time - clear the flag from
        // everyone else before setting it here.
        await this.usersRepository.update({ isProgramManager: true }, { isProgramManager: false });
      }
      user.isProgramManager = dto.isProgramManager;
    }

    return this.usersRepository.save(user);
  }

  findProgramManager(): Promise<User | null> {
    return this.usersRepository.findOne({ where: { isProgramManager: true } });
  }

  private async resolveProjects(projectIds?: number[]): Promise<Project[]> {
    if (!projectIds || projectIds.length === 0) return [];
    return this.projectsRepository.find({ where: { id: In(projectIds) } });
  }
}
