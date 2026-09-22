import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  folderId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  folderName?: string | null;

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
