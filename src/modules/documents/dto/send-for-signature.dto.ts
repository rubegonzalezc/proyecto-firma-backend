import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FieldTypeDto, SigningModeDto } from '../../envelopes/dto/envelope.dto';

/**
 * Zona de firma detectada en el navegador.
 *
 * El análisis vive en el cliente porque ahí está pdf.js con la capa de texto ya
 * resuelta. El servidor no se fía de las coordenadas por buena fe: las valida
 * contra el número de páginas real y contra los límites de la página antes de
 * estampar nada.
 */
export class DetectedPlacementDto {
  @ApiProperty({ example: 1, description: '1-based' })
  @IsInt()
  @Min(1)
  page!: number;

  @ApiProperty({ description: 'Fracción 0..1 del ancho visual, origen top-left' })
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @ApiProperty({ description: 'Fracción 0..1 del alto visual, origen top-left' })
  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  @Max(1)
  w!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  @Max(1)
  h!: number;

  @ApiPropertyOptional({ enum: FieldTypeDto, default: FieldTypeDto.signature })
  @IsOptional()
  @IsEnum(FieldTypeDto)
  type?: FieldTypeDto;

  @ApiProperty({ description: 'Ancho visual de la página en puntos' })
  @IsNumber()
  @Min(1)
  pageWidthPt!: number;

  @ApiProperty({ description: 'Alto visual de la página en puntos' })
  @IsNumber()
  @Min(1)
  pageHeightPt!: number;

  @ApiPropertyOptional({
    description: 'A qué firmante corresponde: 0 = invitado, 1 = emisor',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  partyIndex?: number;

  @ApiPropertyOptional({ description: 'Confianza del detector, 0..1' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class SendForSignatureDto {
  @ApiProperty({ example: 'firmante@empresa.cl' })
  @IsEmail()
  @MaxLength(255)
  signerEmail!: string;

  @ApiPropertyOptional({ example: 'Por favor revisa y firma este documento.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({
    description: 'Si es true, el emisor también se añade como firmante del sobre',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeSender?: boolean;

  @ApiPropertyOptional({
    example: 'contrato_arrendamiento',
    description:
      'Id del catálogo legal. Determina el nivel de firma exigido y los métodos disponibles.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentType?: string;

  @ApiPropertyOptional({
    enum: SigningModeDto,
    default: SigningModeDto.parallel,
    description:
      'En secuencial cada firmante se habilita cuando firma el anterior; en paralelo pueden firmar a la vez.',
  })
  @IsOptional()
  @IsEnum(SigningModeDto)
  mode?: SigningModeDto;

  @ApiPropertyOptional({
    description: 'Si es true y el emisor firma, firma él primero.',
  })
  @IsOptional()
  @IsBoolean()
  senderSignsFirst?: boolean;

  @ApiPropertyOptional({
    type: [DetectedPlacementDto],
    description:
      'Zonas de firma detectadas en el documento. Sin ellas se cae a una posición fija al pie, que puede tapar contenido.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DetectedPlacementDto)
  placements?: DetectedPlacementDto[];
}
