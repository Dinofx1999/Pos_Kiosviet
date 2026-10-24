import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        body = { code: codeFromStatus(status), message: resp };
      } else {
        const r = resp as Record<string, unknown>;
        const message = Array.isArray(r.message) ? r.message.join('; ') : (r.message as string) ?? exception.message;
        body = {
          code: (r.code as string) ?? (status === 400 ? 'VALIDATION_ERROR' : codeFromStatus(status)),
          message,
          details: r.details ?? (Array.isArray(r.message) ? { errors: r.message } : undefined),
        };
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { code: 'DUPLICATE', message: 'Dữ liệu bị trùng', details: { target: exception.meta?.target } };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { code: 'NOT_FOUND', message: 'Dữ liệu không tồn tại' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        body = { code: 'REFERENCE_CONFLICT', message: 'Dữ liệu đang được tham chiếu', details: { field: exception.meta?.field_name } };
      } else if (exception.code === 'P2034' || (exception.code === 'P2010' && /40P01|40001/.test(String((exception.meta as { code?: string } | undefined)?.code ?? exception.message)))) {
        // P2034 = Prisma-detected write conflict; P2010 + 40P01/40001 = Postgres deadlock / serialization failure inside a raw FOR UPDATE
        status = HttpStatus.CONFLICT;
        body = { code: 'TRANSACTION_CONFLICT', message: 'Giao dịch bị xung đột, vui lòng thử lại' };
      } else if (exception.code === 'P2020' || exception.code === 'P2023' || exception.code === 'P2007' || exception.code === 'P2000') {
        status = HttpStatus.BAD_REQUEST;
        body = { code: 'VALIDATION_ERROR', message: 'Giá trị không hợp lệ hoặc vượt giới hạn', details: { prisma: exception.code } };
      } else {
        this.logger.error(`Prisma error ${exception.code}: ${exception.message}`);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ statusCode: status, ...body, path: req.url, timestamp: new Date().toISOString() });
  }
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    default: return 'ERROR';
  }
}
