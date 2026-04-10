import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../store/auth';
import { api } from '../services/api';
import { Eye, EyeOff, Building2, CheckCircle } from 'lucide-react';

const registerSchema = z.object({
  employeeId: z.string().min(1, '사번을 입력해주세요').max(50),
  name: z.string().min(2, '이름은 2자 이상이어야 합니다').max(50),
  email: z.string().email('올바른 이메일 형식이 아닙니다'),
  password: z.string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])/, '영문, 숫자, 특수문자를 각각 1개 이상 포함'),
  passwordConfirm: z.string(),
  departmentId: z.string().uuid('부서를 선택해주세요').optional().or(z.literal('')),
  position: z.string().max(50).optional(),
  phone: z.string().regex(/^01[0-9]\d{7,8}$/, '올바른 전화번호 형식이 아닙니다').optional().or(z.literal('')),
}).refine((d) => d.password === d.passwordConfirm, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['passwordConfirm'],
});

type RegisterForm = z.infer<typeof registerSchema>;

interface Department {
  id: string;
  name: string;
  code: string;
}

export default function RegisterPage() {
  const { register: registerUser, isLoading, error, clearError } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  useEffect(() => {
    api.get('/departments/flat').then(({ data }) => {
      setDepartments(data.data || []);
    }).catch(() => {});
  }, []);

  const onSubmit = async (data: RegisterForm) => {
    try {
      const { passwordConfirm, ...rest } = data;
      const submitData = {
        ...rest,
        departmentId: rest.departmentId || undefined,
        phone: rest.phone || undefined,
        position: rest.position || undefined,
      };
      await registerUser(submitData);
      setSuccess(true);
    } catch {
      // error in store
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-white">
        <div className="bg-white rounded-4xl shadow-xl shadow-primary-100/50 p-8 max-w-md w-full text-center">
          <CheckCircle className="text-green-500 mx-auto mb-4" size={64} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">회원가입 완료</h2>
          <p className="text-gray-500 mb-6">관리자 승인 후 로그인할 수 있습니다.</p>
          <Link to="/login" className="btn-primary inline-block">로그인 페이지로</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-white py-12">
      <div className="w-full max-w-lg p-8">
        <div className="bg-white rounded-4xl shadow-xl shadow-primary-100/50 p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary-200">
              <Building2 className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">회원가입</h1>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm" onClick={clearError}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사번 *</label>
                <input {...register('employeeId')} className={`input-field ${errors.employeeId ? 'input-error' : ''}`} placeholder="EMP001" />
                {errors.employeeId && <p className="text-red-500 text-xs mt-1">{errors.employeeId.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input {...register('name')} className={`input-field ${errors.name ? 'input-error' : ''}`} placeholder="홍길동" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일 *</label>
              <input {...register('email')} type="email" className={`input-field ${errors.email ? 'input-error' : ''}`} placeholder="user@company.com" />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
              <div className="relative">
                <input {...register('password')} type={showPassword ? 'text' : 'password'} className={`input-field pr-10 ${errors.password ? 'input-error' : ''}`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
              <p className="text-xs text-gray-400 mt-1">영문, 숫자, 특수문자 포함 8자 이상</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인 *</label>
              <input {...register('passwordConfirm')} type="password" className={`input-field ${errors.passwordConfirm ? 'input-error' : ''}`} />
              {errors.passwordConfirm && <p className="text-red-500 text-xs mt-1">{errors.passwordConfirm.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <select {...register('departmentId')} className="input-field">
                  <option value="">선택하세요</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">직책</label>
                <input {...register('position')} className="input-field" placeholder="사원" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호</label>
              <input {...register('phone')} className={`input-field ${errors.phone ? 'input-error' : ''}`} placeholder="01012345678" />
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
            </div>

            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 mt-2">
              {isLoading ? '처리 중...' : '회원가입'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700">이미 계정이 있으신가요? 로그인</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
