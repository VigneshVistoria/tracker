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

  // Admins, Executives, and Program Managers see every project - same
  // leadership-wide visibility the Dependency Log grants those three
  // roles. Everyone else only sees the ones assigned to them.
  private static hasLeadershipWideAccess(role: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.EXECUTIVE || role === UserRole.PROGRAM_MANAGER;
  }

  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (ProjectsController.hasLeadershipWideAccess(currentUser.role)) {
      return this.projectsService.findAll(req.user.tenantId);
    }
    return currentUser.projects;
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const project = await this.projectsService.findOne(id, req.user.tenantId);

    if (!ProjectsController.hasLeadershipWideAccess(currentUser.role)) {
      const isAssigned = currentUser.projects.some((p) => p.id === id);
      if (!isAssigned) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    return project;
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateProjectDto, @Req() req: any) {
    return this.projectsService.create(dto, req.user.tenantId);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto, @Req() req: any) {
    return this.projectsService.update(id, dto, req.user.tenantId);
  }
}
