import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SignatureMethodDto } from '../../envelopes/dto/envelope.dto';
import { TYPED_SIGNATURE_STYLES, type TypedSignatureStyle } from '../../signing-portal/dto/portal.dto';
import { DetectedPlacementDto } from './send-for-signature.dto';

/**
 * Autofirma: el emisor firma su propio documento.
 *
 * Pide exactamente lo mismo que el portal de firma externo, y no por simetría:
 * una firma propia es justo la que la contraparte va a impugnar diciendo «eso
 * te lo generaste tú». Sin consentimiento expreso, método declarado y RUT, es
 * la firma más débil del sistema con el mismo aspecto que todas las demás.
 */
export class SelfSignDto {
  @ApiProperty({ enum: SignatureMethodDto })
  @IsEnum(SignatureMethodDto)
  method!: SignatureMethodDto;

  @ApiProperty({ description: 'Aceptación expresa de la declaración de firma' })
  @IsBoolean()
  consentAccepted!: boolean;

  @ApiPropertyOptional({ description: 'PNG en base64. Obligatorio en "draw" y "upload".' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  signatureImageBase64?: string;

  @ApiPropertyOptional({ description: 'Nombre a componer. Solo para el método "type".' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  typedName?: string;

  @ApiPropertyOptional({ enum: TYPED_SIGNATURE_STYLES })
  @IsOptional()
  @IsIn(TYPED_SIGNATURE_STYLES)
  typedStyle?: TypedSignatureStyle;

  @ApiPropertyOptional({ example: '12.345.678-5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rut?: string;

  @ApiPropertyOptional({ example: 'contrato_arrendamiento' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentType?: string;

  @ApiPropertyOptional({
    type: [DetectedPlacementDto],
    description: 'Zonas de firma detectadas en el navegador. El servidor las valida.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DetectedPlacementDto)
  placements?: DetectedPlacementDto[];
}
