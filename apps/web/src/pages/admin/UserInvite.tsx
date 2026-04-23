/**
 * 관리자 사용자 초대 페이지 (v0.19.0 — #4 UI)
 *
 * 경로: /admin/users/invite
 *
 * 기능:
 *   - 이메일·사번·이름·부서·직급·입사일·권한 입력 → POST /auth/invite
 *   - 서버가 랜덤 토큰 생성 + 이메일 발송
 *   - 입사일 지정 시 연차 자동 부여 대상
 *
 * 권한: admin / super_admin
 */
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, UserPlus, Mail, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import { api } from '../../services/api';

interface Department {
  id: string;
  name: string;
  code: string;
}

const ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'user',        label: '일반 사용자',   description: '기본 기능 사용' },
  { value: 'dept_admin',  label: '부서 관리자',   description: '소속 부서 데이터 관리' },
  { value: 'admin',       label: '관리자',        description: '전체 데이터 관리' },
  { value: 'super_admin', label: '슈퍼 관리자',   description: '모든 권한 (주의)' },
];

export default function UserInvitePage() {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; detail?: string } | null>(null);

  // form state
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('user');
  const [position, setPosition] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [phone, setPhone] = useState('');
  const [hireDate, setHireDate] = useState('');

  useEffect(() => {
    api.get('/departments')
      .then(({ data }) => setDepartments(data.data || []))
      .catch(() => setDepartments([]));
  }, []);

  const reset = () => {
    setEmail('');
    setEmployeeId('');
    setName('');
    setRole('user');
    setPosition('');
    setDepartmentId('');
    setPhone('');
    setHireDate('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !employeeId.trim() || !name.trim()) {
      setResult({ type: 'error', message: '이메일·사번·이름은 필수입니다' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        employeeId: employeeId.trim(),
        name: name.trim(),
        role,
      };
      if (position.trim()) payload.position = position.trim();
      if (departmentId) payload.departmentId = departmentId;
      if (phone.trim()) payload.phone = phone.trim();
      if (hireDate) payload.hireDate = hireDate;

      const { data } = await api.post('/auth/invite', payload);
      setResult({
        type: 'success',
        message: '초대 메일이 발송되었습니다',
        detail: `만료: ${new Date(data.data.expiresAt).toLocaleString('ko-KR')}`,
      });
      reset();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string; code?: string } } } };
      setResult({
        type: 'error',
        message: err.response?.data?.error?.message || '초대 발송 실패',
        detail: err.response?.data?.error?.code,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserPlus className="text-primary-600" />
            사용자 초대
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            이메일로 가입 링크를 보냅니다. 수신자가 링크를 클릭해 비밀번호를 설정합니다.
          </p>
        </div>
      </div>

      {result && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl flex items-start gap-2 ${
            result.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {result.type === 'success' ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <AlertCircle size={18} className="shrink-0 mt-0.5" />}
          <div>
            <div className="font-medium">{result.message}</div>
            {result.detail && <div className="text-xs mt-0.5 opacity-80">{result.detail}</div>}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="bg-white rounded-2xl p-6 border border-gray-200 space-y-4">
        <Row label="이메일 *">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hong@ks-corporation.co.kr"
            className="input-field w-full"
            required
            autoComplete="off"
          />
        </Row>

        <Row label="사번 *">
          <input
            type="text"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="KSC2026001"
            className="input-field w-full"
            required
            maxLength={50}
          />
        </Row>

        <Row label="이름 *">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="input-field w-full"
            required
            maxLength={50}
          />
        </Row>

        <Row label="부서">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="input-field w-full"
          >
            <option value="">(선택)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </Row>

        <Row label="직급">
          <input
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="대리"
            className="input-field w-full"
            maxLength={50}
          />
        </Row>

        <Row label="전화번호">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01012345678 (하이픈 없이)"
            className="input-field w-full"
            pattern="01[0-9][0-9]{7,8}"
          />
        </Row>

        <Row label="입사일" help="연차 자동 부여 기준일">
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className="input-field w-full"
          />
        </Row>

        <Row label="권한">
          <div className="space-y-1.5">
            {ROLE_OPTIONS.map((r) => (
              <label key={r.value} className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-800">{r.label}</div>
                  <div className="text-xs text-gray-500">{r.description}</div>
                </div>
              </label>
            ))}
          </div>
        </Row>

        <div className="flex gap-2 justify-end pt-3 border-t">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="btn-secondary"
          >
            취소
          </button>
          <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> 발송 중...</>
            ) : (
              <><Mail size={16} /> 초대 메일 발송</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({
  label, help, children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {help && <span className="ml-2 text-xs text-gray-400">({help})</span>}
      </label>
      {children}
    </div>
  );
}
