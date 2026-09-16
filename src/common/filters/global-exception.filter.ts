import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Error de PostgREST/Supabase: un objeto plano, no una instancia de `Error`. */
interface PostgrestError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Códigos de PostgreSQL que significan «falta aplicar una migración». */
const SCHEMA_DRIFT_CODES = new Set(['42703', '42P01', '42883']);

function isPostgrestError(value: unknown): value is PostgrestError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PostgrestError).code === 'string' &&
    typeof (value as PostgrestError).message === 'string'
  );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const route = `${request?.method ?? '?'} ${request?.url ?? '?'}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        message = (obj.message as string) ?? message;
        details = obj;
      }
    } else if (isPostgrestError(exception)) {
      // Los errores de Supabase llegan como objetos planos, así que antes no
      // entraban por ninguna rama y se perdían: el cliente veía un 500 mudo y
      // el log no decía nada. Diagnosticarlo costaba una sesión entera.
      this.logger.error(
        `${route} · PostgREST ${exception.code}: ${exception.message}` +
          (exception.details ? ` | ${exception.details}` : '') +
          (exception.hint ? ` | ${exception.hint}` : ''),
      );

      if (SCHEMA_DRIFT_CODES.has(exception.code)) {
        // El nombre de la columna que falta no es un secreto y es justo lo que
        // hace falta para saber qué migración aplicar.
        message =
          'La base de datos no tiene aplicadas todas las migraciones. ' +
          `Falta aplicar el esquema: ${exception.message}`;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`${route} · ${exception.message}`, exception.stack);
    } else {
      // Cualquier otra cosa que alguien haya lanzado. Registrarla es la
      // diferencia entre un fallo diagnosticable y un 500 sin rastro.
      this.logger.error(`${route} · excepción no reconocida: ${safeStringify(exception)}`);
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(details && typeof details === 'object' ? { details } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
