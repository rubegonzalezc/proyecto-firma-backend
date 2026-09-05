import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
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
import { SignDocumentDto } from './dto/document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar documentos del usuario' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.documentsService.findAll(user);
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
      properties: { file: { type: 'string', format: 'binary' } },
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
    @Req() request: Request,
  ) {
    return this.documentsService.create(user, file, request);
  }

  @Post(':id/sign')
  @ApiOperation({ summary: 'Registrar firma y PDF firmado' })
  sign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignDocumentDto,
    @Req() request: Request,
  ) {
    return this.documentsService.sign(user, id, dto, request);
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
