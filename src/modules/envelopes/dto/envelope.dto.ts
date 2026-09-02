import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum SigningModeDto {
  sequential = 'sequential',
  parallel = 'parallel',
}

export enum FieldTypeDto {
  signature = 'signature',
  initials = 'initials',
  name = 'name',
  rut = 'rut',
  date = 'date',
  text = 'text',
}

export class SignerInputDto {
  @ApiProperty({ description: 'Id temporal del editor, para asociar los campos', example: 'tmp-1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tempId!: string;

  @ApiProperty({ example: 'Ana Rojas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: 'ana@empresa.cl' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ example: 'Arrendador' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  roleLabel?: string;
}

export class FieldInputDto {
  @ApiProperty({ description: 'tempId del firmante al que pertenece el campo' })
  @IsString()
  @IsNotEmpty()
  signerTempId!: string;

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

  @ApiProperty({ enum: FieldTypeDto })
  @IsEnum(FieldTypeDto)
  type!: FieldTypeDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ enum: [0, 90, 180, 270] })
  @IsOptional()
  @IsInt()
  pageRotation?: number;

  @ApiProperty({ description: 'Ancho visual de la página en puntos, al definir el campo' })
  @IsNumber()
  @Min(1)
  pageWidthPt!: number;

  @ApiProperty({ description: 'Alto visual de la página en puntos, al definir el campo' })
  @IsNumber()
  @Min(1)
  pageHeightPt!: number;

  @ApiPropertyOptional({ enum: ['heuristic', 'manual', 'fallback'] })
  @IsOptional()
  @IsString()
  detectionSource?: 'heuristic' | 'manual' | 'fallback';

  @ApiPropertyOptional({ description: 'Confianza del detector, 0..1' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  detectionConfidence?: number;
}

export class CreateEnvelopeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({ example: 'Contrato de arrendamiento' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiProperty({ enum: SigningModeDto, default: SigningModeDto.sequential })
  @IsEnum(SigningModeDto)
  mode!: SigningModeDto;

  @ApiProperty({ type: [SignerInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];

  @ApiProperty({ type: [FieldInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldInputDto)
  fields!: FieldInputDto[];
}

export class UpdateEnvelopeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ enum: SigningModeDto })
  @IsOptional()
  @IsEnum(SigningModeDto)
  mode?: SigningModeDto;

  @ApiPropertyOptional({ description: 'ISO 8601' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class VoidEnvelopeDto {
  @ApiPropertyOptional({ example: 'Se acordó otro instrumento' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
