import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse, PaginatedResponse } from '../types';

export function successResponse<T>(res: Response, data: T, message = '操作成功', statusCode = 200): void {
  const response: ApiResponse<T> = {
    success: true,
    code: 'OK',
    message,
    data,
    meta: {
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(statusCode).json(response);
}

export function paginatedResponse<T>(
  res: Response,
  data: T[],
  page: number,
  pageSize: number,
  total: number
): void {
  const response: PaginatedResponse<T> = {
    success: true,
    code: 'OK',
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
  res.status(200).json(response);
}

export function errorResponse(res: Response, statusCode: number, code: string, message: string): void {
  const response: ApiResponse = {
    success: false,
    code,
    message,
    meta: {
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(statusCode).json(response);
}
