import { z } from 'zod';

// ===== 인증 =====
export const loginSchema = z.object({
  employee_id: z
    .string()
    .min(1, '사번을 입력해주세요')
    .max(50, '사번은 50자 이내로 입력해주세요'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .max(100, '비밀번호는 100자 이내로 입력해주세요'),
});

export const registerSchema = z.object({
  employee_id: z
    .string()
    .min(1, '사번을 입력해주세요')
    .max(50),
  name: z
    .string()
    .min(2, '이름은 2자 이상이어야 합니다')
    .max(50, '이름은 50자 이내로 입력해주세요'),
  email: z
    .string()
    .email('올바른 이메일 형식이 아닙니다'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(
      /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
      '영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다'
    ),
  password_confirm: z.string(),
  department_id: z.string().uuid('올바른 부서를 선택해주세요'),
  position: z.string().optional(),
  phone: z
    .string()
    .regex(/^01[0-9]-?\d{3,4}-?\d{4}$/, '올바른 전화번호 형식이 아닙니다')
    .optional(),
}).refine((data) => data.password === data.password_confirm, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['password_confirm'],
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, '현재 비밀번호를 입력해주세요'),
  new_password: z
    .string()
    .min(8, '새 비밀번호는 8자 이상이어야 합니다')
    .regex(
      /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
      '영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다'
    ),
  new_password_confirm: z.string(),
}).refine((data) => data.new_password === data.new_password_confirm, {
  message: '새 비밀번호가 일치하지 않습니다',
  path: ['new_password_confirm'],
});

// ===== 페이지네이션 =====
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// ===== 타입 추출 =====
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
