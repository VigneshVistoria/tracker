import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    private eventsGateway: EventsGateway,
  ) {}

  findAll(tenantId: number): Promise<Project[]> {
    return this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOne(id: number, tenantId: number): Promise<Project> {
    const project = await this.projectsRepository.findOne({ where: { id, tenantId } });
    if (!project) {
      throw new NotFoundException(`Project #${id} not found`);
    }
    return project;
  }

  create(dto: CreateProjectDto, tenantId: number): Promise<Project> {
    const project = this.projectsRepository.create({ ...dto, tenantId });
    return this.projectsRepository.save(project).then((saved) => {
      this.eventsGateway.emitProjectCreated(saved);
      return saved;
    });
  }

  async update(id: number, dto: UpdateProjectDto, tenantId: number): Promise<Project> {
    const project = await this.findOne(id, tenantId);
    Object.assign(project, dto);
    return this.projectsRepository.save(project);
  }
}
