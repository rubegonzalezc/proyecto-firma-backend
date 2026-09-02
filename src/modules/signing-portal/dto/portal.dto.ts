import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos enviado al correo' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code!: string;
}

export class SubmitSignatureDto {
  @ApiProperty({ description: 'Imagen PNG de la firma en base64, sin prefijo data:' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000_000)
  signatureImageBase64!: string;

  @ApiPropertyOptional({ description: 'Nombre con el que firma, si difiere del registrado' })
  @IsString()
  @ApiPropertyOptional()
  @MaxLength(120)
  fullName?: string;
}

export class DeclineDto {
  @ApiProperty({ example: 'No estoy de acuerdo con la cláusula tercera' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
