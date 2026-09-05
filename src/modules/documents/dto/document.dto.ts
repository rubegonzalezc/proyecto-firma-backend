import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SignDocumentDto {
  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  signerName!: string;

  @ApiProperty({ example: 'juan@empresa.cl' })
  @IsEmail()
  @MaxLength(255)
  signerEmail!: string;

  @ApiProperty({ description: 'PDF firmado en base64' })
  @IsString()
  @IsNotEmpty()
  signedPdfBase64!: string;
}

export class DocumentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['draft', 'signed'] })
  status!: string;

  @ApiPropertyOptional()
  signerName?: string | null;

  @ApiPropertyOptional()
  signerEmail?: string | null;

  @ApiPropertyOptional()
  verificationCode?: string | null;

  @ApiPropertyOptional()
  signedSha256?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional()
  signedAt?: string | null;
}
