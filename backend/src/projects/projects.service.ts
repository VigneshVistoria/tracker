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

  findAll(): Promise<Project[]> {
    return this.projectsRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projectsRepository.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project #${id} not found`);
    }
    return project;
  }

  create(dto: CreateProjectDto): Promise<Project> {
    const project = this.projectsRepository.create(dto);
    return this.projectsRepository.save(project).then((saved) => {
      this.eventsGateway.emitProjectCreated(saved);
      return saved;
    });
  }

  async update(id: number, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.findOne(id);
    Object.assign(project, dto);
    return this.projectsRepository.save(project);
  }
}
