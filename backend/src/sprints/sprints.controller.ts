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
  findAllForProject(@Query('projectId', ParseIntPipe) projectId: number) {
    return this.sprintsService.findAllForProject(projectId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sprintsService.findOneWithIssues(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateSprintDto, @Req() req: any) {
    return this.sprintsService.create(dto, req.user.sub);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSprintDto) {
    return this.sprintsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sprintsService.remove(id);
  }

  @Post(':id/issues')
  @UseGuards(AdminGuard)
  addIssues(@Param('id', ParseIntPipe) id: number, @Body() dto: AddIssuesToSprintDto) {
    return this.sprintsService.addIssues(id, dto);
  }

  @Delete(':id/issues/:issueId')
  @UseGuards(AdminGuard)
  removeIssue(@Param('id', ParseIntPipe) id: number, @Param('issueId', ParseIntPipe) issueId: number) {
    return this.sprintsService.removeIssue(id, issueId);
  }
}
