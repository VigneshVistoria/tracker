import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { DependenciesService } from './dependencies.service';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { UpdateDependencyDto } from './dto/update-dependency.dto';
import { UpdateDependencyStatusDto } from './dto/update-dependency-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

@Controller('dependencies')
@UseGuards(JwtAuthGuard)
export class DependenciesController {
  constructor(
    private dependenciesService: DependenciesService,
    private usersService: UsersService,
  ) {}

  // Leadership-wide visibility across every dependency, same roles that
  // see every issue. Declared before ':id' below for the same routing
  // reason as issues/dependencies/received.
  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admins, Program Managers, and Executives can view all dependencies.');
    }
    return this.dependenciesService.findAll(req.user.tenantId);
  }

  // "Received" inbox - dependencies the current user is the owner of
  // (being waited on for).
  @Get('received')
  async findReceived(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.dependenciesService.findReceived(currentUser.id, req.user.tenantId);
  }

  // "Sent" outbox - dependencies the current user filed against someone
  // else.
  @Get('sent')
  async findSent(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.dependenciesService.findSent(currentUser.id, req.user.tenantId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const dependency = await this.dependenciesService.findOne(id, req.user.tenantId);
    if (!this.dependenciesService.canView(dependency, currentUser)) {
      throw new ForbiddenException('You do not have access to this dependency.');
    }
    return dependency;
  }

  // Same role restriction as spinning off a dependency ticket from an
  // issue: Executives are read-only everywhere, and Clients don't file
  // internal dependency requests.
  @Post()
  async create(@Body() dto: CreateDependencyDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.EXECUTIVE) {
      throw new ForbiddenException('Executives have read-only access.');
    }
    if (currentUser.role === UserRole.CLIENT) {
      throw new ForbiddenException('Clients cannot create dependency requests.');
    }
    return this.dependenciesService.create(dto, currentUser.id, currentUser.email, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDependencyDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.dependenciesService.update(id, dto, {
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    }, req.user.tenantId);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDependencyStatusDto,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.dependenciesService.updateStatus(id, dto.status, {
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    }, req.user.tenantId);
  }
}
