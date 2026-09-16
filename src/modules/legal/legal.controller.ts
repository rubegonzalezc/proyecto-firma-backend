import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { findDocumentType } from './document-types.catalog';
import { LegalService } from './legal.service';
import type { SignatureLevel } from './signature-levels';

/**
 * Catálogo legal. Es público a propósito: la orientación sobre qué firma exige
 * cada documento también sirve a quien recibe un enlace de firma sin tener
 * cuenta, y no revela nada del contenido de ningún sobre.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Public()
  @Get('catalog')
  @ApiOperation({ summary: 'Tipos de documento, niveles de firma y métodos disponibles' })
  catalog() {
    return this.legal.catalog();
  }

  @Public()
  @Get('document-types/:id')
  @ApiOperation({ summary: 'Qué firma exige un tipo de documento concreto' })
  recommend(@Param('id') id: string, @Query('level') level?: SignatureLevel) {
    if (!findDocumentType(id)) {
      throw new NotFoundException(`Tipo de documento desconocido: ${id}`);
    }
    return this.legal.recommend(id, level);
  }
}
