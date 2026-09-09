import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
