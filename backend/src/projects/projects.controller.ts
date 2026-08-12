import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private projectsService: ProjectsService,
    private usersService: UsersService,
  ) {}

  // Admins see every project. Regular users only see the ones assigned to them.
  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.ADMIN) {
      return this.projectsService.findAll();
    }
    return currentUser.projects;
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const project = await this.projectsService.findOne(id);

    if (currentUser.role !== UserRole.ADMIN) {
      const isAssigned = currentUser.projects.some((p) => p.id === id);
      if (!isAssigned) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    return project;
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }
}
