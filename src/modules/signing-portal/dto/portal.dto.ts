import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { SignatureMethodDto } from '../../envelopes/dto/envelope.dto';

export class VerifyOtpDto {
  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos enviado al correo' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code!: string;
}

/** Estilos tipográficos disponibles para la firma escrita. */
export const TYPED_SIGNATURE_STYLES = ['clasico', 'moderno', 'maquina'] as const;
export type TypedSignatureStyle = (typeof TYPED_SIGNATURE_STYLES)[number];

export class SubmitSignatureDto {
  @ApiProperty({
    enum: SignatureMethodDto,
    description: 'Forma en que el firmante produce su firma',
  })
  @IsEnum(SignatureMethodDto)
  method!: SignatureMethodDto;

  @ApiProperty({
    description:
      'Aceptación expresa de la declaración de consentimiento. Sin esto no se estampa nada.',
  })
  @IsBoolean()
  consentAccepted!: boolean;

  @ApiPropertyOptional({
    description: 'Imagen PNG en base64. Obligatoria para los métodos "draw" y "upload".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  signatureImageBase64?: string;

  @ApiPropertyOptional({
    description: 'Nombre a componer tipográficamente. Solo para el método "type".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  typedName?: string;

  @ApiPropertyOptional({
    enum: TYPED_SIGNATURE_STYLES,
    description: 'Estilo de la firma escrita.',
  })
  @IsOptional()
  @IsIn(TYPED_SIGNATURE_STYLES)
  typedStyle?: TypedSignatureStyle;

  @ApiPropertyOptional({
    example: '12.345.678-5',
    description: 'RUT del firmante. Obligatorio si el sobre lo exige.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rut?: string;
}

export class DeclineDto {
  @ApiProperty({ example: 'No estoy de acuerdo con la cláusula tercera' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
