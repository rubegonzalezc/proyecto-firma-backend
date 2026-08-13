import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller('verify')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Verificar documento por código (público)' })
  @ApiParam({ name: 'code', example: 'ABCD-1234-EFGH' })
  verify(@Param('code') code: string) {
    return this.verificationService.verify(code);
  }
}
