// 공유 상수 정의

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  DEPT_ADMIN: 'dept_admin',
  USER: 'user',
  GUEST: 'guest',
} as const;

export const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  LOCKED: 'locked',
  PENDING: 'pending',
} as const;

export const APPROVAL_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;

export const TASK_ORDER_STATUS = {
  DRAFT: 'draft',
  INSTRUCTED: 'instructed',
  IN_PROGRESS: 'in_progress',
  PARTIAL_COMPLETE: 'partial_complete',
  WORK_COMPLETE: 'work_complete',
  BILLING_COMPLETE: 'billing_complete',
  FINAL_COMPLETE: 'final_complete',
} as const;

export const MESSENGER_ROOM_TYPE = {
  DIRECT: 'direct',
  GROUP: 'group',
} as const;

export const ATTENDANCE_TYPE = {
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const FILE_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_VIDEO_SIZE: 500 * 1024 * 1024, // 500MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_DOC_TYPES: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/quicktime'],
} as const;
