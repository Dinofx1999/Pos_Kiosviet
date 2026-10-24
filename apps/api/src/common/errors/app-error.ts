import { HttpException, HttpStatus } from '@nestjs/common';

/** Business error with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const Errors = {
  notFound: (entity: string, id?: string) =>
    new AppError('NOT_FOUND', `${entity} không tồn tại`, HttpStatus.NOT_FOUND, id ? { entity, id } : { entity }),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này') =>
    new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN),
  branchAccessDenied: (branchId: string) =>
    new AppError('BRANCH_ACCESS_DENIED', 'Bạn không được phép thao tác trên chi nhánh này', HttpStatus.FORBIDDEN, { branchId }),
  warehouseAccessDenied: (warehouseId: string) =>
    new AppError('WAREHOUSE_ACCESS_DENIED', 'Bạn không được phép thao tác trên kho này', HttpStatus.FORBIDDEN, { warehouseId }),
  duplicate: (code: string, message: string, details?: Record<string, unknown>) =>
    new AppError(code, message, HttpStatus.CONFLICT, details),
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, details),
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new AppError(code, message, HttpStatus.CONFLICT, details),
  insufficientStock: (details: Record<string, unknown>) =>
    new AppError('INSUFFICIENT_STOCK', 'Không đủ tồn kho', HttpStatus.CONFLICT, details),
};
