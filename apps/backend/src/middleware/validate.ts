import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Zod 스키마로 요청 body 검증
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details: Record<string, string[]> = {};
        for (const issue of err.issues) {
          const field = issue.path.join('.');
          if (!details[field]) details[field] = [];
          details[field].push(issue.message);
        }

        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해주세요',
            details,
          },
        });
        return;
      }
      next(err);
    }
  };
}

/**
 * Zod 스키마로 query 파라미터 검증
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '쿼리 파라미터를 확인해주세요',
          },
        });
        return;
      }
      next(err);
    }
  };
}
