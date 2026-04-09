import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../store/auth';
import { Eye, EyeOff, Building2 } from 'lucide-react';

const loginSchema = z.object({
  employeeId: z.string().min(1, '사번을 입력해주세요'),
  password: z.string().min(1, '비밀번호를 입력해주세요'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.employeeId, data.password);
      navigate('/dashboard');
    } catch {
      // error is set in store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-white">
      <div className="w-full max-w-md p-8">
        <div className="bg-white rounded-4xl shadow-xl shadow-primary-100/50 p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-200">
              <Building2 className="text-white" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Project Office</h1>
            <p className="text-gray-400 mt-1 text-sm">사내 업무 통합 플랫폼</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm" onClick={clearError}>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사번</label>
              <input
                {...register('employeeId')}
                type="text"
                placeholder="사번을 입력하세요"
                className={`input-field ${errors.employeeId ? 'input-error' : ''}`}
                autoFocus
              />
              {errors.employeeId && <p className="text-red-500 text-xs mt-1">{errors.employeeId.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호를 입력하세요"
                  className={`input-field pr-10 ${errors.password ? 'input-error' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3">
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/register" className="text-sm text-primary-600 hover:text-primary-700">
              계정이 없으신가요? 회원가입
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
