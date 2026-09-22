import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/types/database.types';
import { CreateFolderDto, UpdateFolderDto } from './dto/folder.dto';
import { FoldersService } from './folders.service';

@ApiTags('folders')
@ApiBearerAuth()
@Controller('folders')
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar carpetas del usuario' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.foldersService.findAll(user);
  }

  @Post()
  @ApiOperation({ summary: 'Crear carpeta organizacional' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFolderDto) {
    return this.foldersService.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombrar carpeta' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.foldersService.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar carpeta (los documentos quedan sin carpeta)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.foldersService.remove(user, id);
  }
}
