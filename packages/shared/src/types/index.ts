// 공유 타입 정의

// ===== 공통 =====
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ===== 사용자 =====
export type UserRole = 'super_admin' | 'admin' | 'dept_admin' | 'user' | 'guest';
export type UserStatus = 'active' | 'inactive' | 'locked' | 'pending';

export interface User {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  department_id?: string;
  position?: string;
  profile_image?: string;
  created_at: string;
  updated_at: string;
}

// ===== 인증 =====
export interface LoginRequest {
  employee_id: string;
  password: string;
  device_info?: DeviceInfo;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface DeviceInfo {
  device_id: string;
  device_type: 'web' | 'ios' | 'android';
  device_name: string;
  push_token?: string;
}

// ===== 부서 =====
export interface Department {
  id: string;
  name: string;
  code: string;
  parent_id?: string;
  manager_id?: string;
  sort_order: number;
  is_active: boolean;
}

// ===== 알림 =====
export type NotificationType =
  | 'approval'
  | 'messenger'
  | 'attendance'
  | 'calendar'
  | 'board'
  | 'task_order'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}
