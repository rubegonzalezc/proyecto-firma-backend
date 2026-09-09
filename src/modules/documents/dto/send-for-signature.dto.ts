import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
