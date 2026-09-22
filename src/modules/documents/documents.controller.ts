import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Patch,
  UploadedFile,
  UseInterceptors,
  Query,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/types/database.types';
import { DocumentsService } from './documents.service';
import { SelfSignDto } from './dto/self-sign.dto';
import { SendForSignatureDto } from './dto/send-for-signature.dto';
import { MoveDocumentDto } from '../folders/dto/folder.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar documentos del usuario' })
  @ApiQuery({
    name: 'folderId',
    required: false,
    description: 'Filtrar por carpeta; use "none" para documentos sin carpeta',
  })
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('folderId') folderId?: string,
  ) {
    return this.documentsService.findAll(user, folderId);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Listar documentos enviados al usuario para firmar' })
  findInbox(@CurrentUser() user: AuthUser) {
    return this.documentsService.findInbox(user);
  }

  @Get('inbox/:signerId/download')
  @ApiOperation({ summary: 'Descargar PDF de una invitación de firma' })
  @ApiQuery({ name: 'type', enum: ['original', 'signed'], required: false })
  downloadInbox(
    @CurrentUser() user: AuthUser,
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Query('type') type: 'original' | 'signed' = 'signed',
    @Req() request: Request,
  ) {
    return this.documentsService.getInboxDownloadUrl(user, signerId, type, request);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener documento por ID' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Subir documento PDF' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        folderId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('folderId') folderId: string | undefined,
    @Req() request: Request,
  ) {
    return this.documentsService.create(user, file, request, folderId);
  }

  @Patch(':id/folder')
  @ApiOperation({ summary: 'Mover documento a otra carpeta o a la raíz' })
  moveToFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveDocumentDto,
  ) {
    return this.documentsService.moveToFolder(user, id, dto.folderId ?? null);
  }

  @Post(':id/self-sign')
  @ApiOperation({
    summary: 'Firmar tu propio documento, con el mismo consentimiento y método que un firmante externo',
  })
  selfSign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelfSignDto,
    @Req() request: Request,
  ) {
    return this.documentsService.selfSign(user, id, dto, request);
  }

  @Post(':id/send-for-signature')
  @ApiOperation({ summary: 'Enviar documento a un firmante con enlace de firma' })
  sendForSignature(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendForSignatureDto,
    @Req() request: Request,
  ) {
    return this.documentsService.sendForSignature(user, id, dto, request);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'URL firmada para descargar PDF' })
  @ApiQuery({ name: 'type', enum: ['original', 'signed'], required: false })
  download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type: 'original' | 'signed' = 'signed',
    @Req() request: Request,
  ) {
    return this.documentsService.getDownloadUrl(user, id, type, request);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar documento' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.remove(user, id);
  }
}
