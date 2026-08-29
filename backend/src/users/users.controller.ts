import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { User } from './user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard) // every route requires login; admin-only ones add AdminGuard below
export class UsersController {
  constructor(private usersService: UsersService) {}

  // Any logged-in user can see their own full profile - used by the
  // frontend to know things like "am I the Program Manager" without
  // needing admin access to /users/:id.
  @Get('me')
  async findMe(@Req() req: any) {
    const user = await this.usersService.findById(req.user.sub);
    return this.toSafeUser(user);
  }

  // Any logged-in user can see this minimal list - needed to populate the
  // "Assignee" dropdown when creating/editing an issue.
  @Get('assignable')
  async findAssignable() {
    const users = await this.usersService.findAll();
    return users.map((u) => ({ id: u.id, email: u.email, fullName: u.fullName }));
  }

  @Get()
  @UseGuards(AdminGuard)
  async findAll() {
    const users = await this.usersService.findAll();
    return users.map(this.toSafeUser);
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    return this.toSafeUser(user);
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateUserDto, @Req() req: any) {
    const user = await this.usersService.adminCreate(dto, req.user.tenantId);
    return this.toSafeUser(user);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.update(id, dto);
    return this.toSafeUser(user);
  }

  // Strips the password hash before sending a user back to the frontend.
  private toSafeUser(user: User | null) {
    if (!user) return user;
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
