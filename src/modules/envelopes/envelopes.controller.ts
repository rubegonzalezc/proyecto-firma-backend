import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/types/database.types';
import { CreateEnvelopeDto, UpdateEnvelopeDto, VoidEnvelopeDto } from './dto/envelope.dto';
import { EnvelopesService } from './envelopes.service';

@ApiTags('envelopes')
@ApiBearerAuth()
@Controller('envelopes')
export class EnvelopesController {
  constructor(private readonly envelopes: EnvelopesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un sobre con firmantes y campos de firma' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEnvelopeDto, @Req() request: Request) {
    return this.envelopes.create(user, dto, request);
  }

  @Get()
  @ApiOperation({ summary: 'Listar los sobres del usuario' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.envelopes.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del sobre con firmantes y campos' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.envelopes.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modificar un sobre en borrador' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnvelopeDto,
  ) {
    return this.envelopes.update(user, id, dto);
  }

  @Post(':id/send')
  @ApiOperation({
    summary: 'Enviar a firma',
    description:
      'Valida el sobre y emite un enlace por firmante. Los enlaces en claro se devuelven una única vez.',
  })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.envelopes.send(user, id, request);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Anular el sobre y revocar los enlaces emitidos' })
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidEnvelopeDto,
    @Req() request: Request,
  ) {
    return this.envelopes.void(user, id, dto?.reason, request);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'URL firmada de descarga' })
  @ApiQuery({ name: 'type', enum: ['original', 'current', 'final'], required: false })
  download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type: 'original' | 'current' | 'final' = 'final',
    @Req() request: Request,
  ) {
    return this.envelopes.getDownloadUrl(user, id, type, request);
  }

  @Get(':id/audit')
  @ApiOperation({ summary: 'Traza de auditoría del sobre' })
  audit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.envelopes.auditTrail(user, id);
  }
}
