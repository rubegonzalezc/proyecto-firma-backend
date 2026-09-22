import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateFolderDto {
  @ApiProperty({ example: 'Contratos 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

export class UpdateFolderDto {
  @ApiProperty({ example: 'Contratos laborales' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

export class FolderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MoveDocumentDto {
  @ApiPropertyOptional({
    description: 'Id de carpeta destino; omitir o null para sacar del folder',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}
