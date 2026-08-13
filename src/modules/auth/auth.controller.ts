import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/types/database.types';
import { AuthService } from './auth.service';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Obtener perfil del usuario autenticado',
    description: 'Requiere BetterAuth (pendiente de implementación).',
  })
  getMe(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user);
  }
}
