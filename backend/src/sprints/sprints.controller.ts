import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { AddIssuesToSprintDto } from './dto/add-issues-to-sprint.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Viewing sprints is open to any logged-in user (same as Projects) -
// creating, editing, and moving issues in/out of a sprint is admin-only,
// consistent with how Projects are managed today.
@Controller('sprints')
@UseGuards(JwtAuthGuard)
export class SprintsController {
  constructor(private sprintsService: SprintsService) {}

  @Get()
  findAllForProject(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    return this.sprintsService.findAllForProject(projectId, req.user.tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.sprintsService.findOneWithIssues(id, req.user.tenantId);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateSprintDto, @Req() req: any) {
    return this.sprintsService.create(dto, req.user.sub, req.user.tenantId);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSprintDto, @Req() req: any) {
    return this.sprintsService.update(id, dto, req.user.tenantId);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.sprintsService.remove(id, req.user.tenantId);
  }

  @Post(':id/issues')
  @UseGuards(AdminGuard)
  addIssues(@Param('id', ParseIntPipe) id: number, @Body() dto: AddIssuesToSprintDto, @Req() req: any) {
    return this.sprintsService.addIssues(id, dto, req.user.tenantId);
  }

  @Delete(':id/issues/:issueId')
  @UseGuards(AdminGuard)
  removeIssue(@Param('id', ParseIntPipe) id: number, @Param('issueId', ParseIntPipe) issueId: number, @Req() req: any) {
    return this.sprintsService.removeIssue(id, issueId, req.user.tenantId);
  }
}
