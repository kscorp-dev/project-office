/**
 * 관리자 메일 수신 테스트 페이지 (v0.20.0)
 *
 * 경로: /admin/mail/test
 *
 * 기능:
 *   1. 모든 MailAccount 목록 (활성/비활성/사용자)
 *   2. 각 계정에 대해 "수신 테스트" 버튼 클릭 → IMAP 접속 → INBOX 최근 N통 헤더 표시
 *   3. 응답시간 + 성공/실패 + 오류 메시지 표시
 *   4. 최근 수신 메일 미리보기 (from / subject / date / seen / size)
 *
 * 권한: admin / super_admin (router 레벨에서 이미 적용됨)
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Mail, Loader2, CheckCircle2, AlertCircle, X,
  RefreshCw, Inbox, MailOpen,
} from 'lucide-react';
import { api } from '../../services/api';

interface MailAccount {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  imapHost: string;
  imapPort: number;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  userId?: string | null;
  user?: { id: string; name: string; employeeId: string } | null;
}

interface TestResult {
  ok: boolean;
  email: string;
  totalMessages?: number;
  recentMessages?: Array<{
    uid: number;
    from: string | null;
    subject: string | null;
    date: string | null;
    seen: boolean;
    size: number;
  }>;
  error?: string;
  elapsedMs: number;
}

export default function MailReceiveTestPage() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [limit, setLimit] = useState(5);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/mail/accounts');
      setAccounts(data.data || []);
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAccounts(); }, []);

  const runTest = async (account: MailAccount) => {
    setTestingId(account.id);
    try {
      const { data } = await api.post(
        `/admin/mail/accounts/${account.id}/test-inbox?limit=${limit}`,
      );
      setResults(new Map(results.set(account.id, data.data)));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      setToast({
        type: 'error',
        message: err.response?.data?.error?.message || '테스트 실패',
      });
    } finally {
      setTestingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="text-primary-600" />
            메일 수신 테스트
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            각 메일 계정의 IMAP 접속과 INBOX 수신 상태를 확인합니다.
            실제 서버에 접속하여 최근 메일 헤더를 가져옵니다.
          </p>
        </div>
        <button
          onClick={loadAccounts}
          className="btn-secondary text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}

      {/* 옵션 */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <label className="text-gray-600">가져올 메일 수:</label>
        <select
          value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value))}
          className="input-field text-sm"
        >
          <option value={3}>3통</option>
          <option value={5}>5통</option>
          <option value={10}>10통</option>
          <option value={20}>20통</option>
        </select>
      </div>

      {/* 계정 목록 */}
      {loading ? (
        <div className="p-12 text-center text-gray-500">
          <Loader2 size={24} className="mx-auto animate-spin" />
          <p className="mt-2">계정 목록을 불러오는 중...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="p-12 bg-white border border-gray-200 rounded-xl text-center text-gray-500">
          <Mail size={40} className="mx-auto mb-2 opacity-30" />
          <p>등록된 메일 계정이 없습니다.</p>
          <p className="text-xs mt-1">관리 콘솔 → 메일 관리 탭에서 먼저 계정을 등록해주세요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => {
            const result = results.get(account.id);
            const testing = testingId === account.id;
            return (
              <div
                key={account.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <div className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    account.isActive ? 'bg-primary-100' : 'bg-gray-100'
                  }`}>
                    <Mail className={account.isActive ? 'text-primary-600' : 'text-gray-400'} size={20} />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{account.email}</span>
                      {!account.isActive && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">비활성</span>
                      )}
                      {account.user && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          {account.user.name} ({account.user.employeeId})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {account.imapHost}:{account.imapPort}
                      {account.lastSyncAt && (
                        <span className="ml-2">
                          · 마지막 동기화: {new Date(account.lastSyncAt).toLocaleString('ko-KR')}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => runTest(account)}
                    disabled={testing || !account.isActive}
                    className="btn-primary text-sm flex items-center gap-1 min-w-[110px] justify-center"
                  >
                    {testing ? (
                      <><Loader2 size={14} className="animate-spin" /> 테스트 중...</>
                    ) : (
                      <><Inbox size={14} /> 수신 테스트</>
                    )}
                  </button>
                </div>

                {/* 결과 */}
                {result && (
                  <div className="border-t border-gray-100">
                    <div
                      className={`px-4 py-2 text-sm flex items-center gap-2 ${
                        result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                      }`}
                    >
                      {result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                      <span className="font-medium">
                        {result.ok
                          ? `접속 성공 (INBOX ${result.totalMessages ?? 0}통)`
                          : `접속 실패: ${result.error ?? '알 수 없는 오류'}`}
                      </span>
                      <span className="ml-auto text-xs opacity-70">
                        {result.elapsedMs}ms
                      </span>
                    </div>

                    {result.ok && result.recentMessages && result.recentMessages.length > 0 && (
                      <div className="max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-600 text-xs">
                            <tr>
                              <th className="text-left px-4 py-2 w-10"></th>
                              <th className="text-left px-4 py-2">보낸이</th>
                              <th className="text-left px-4 py-2">제목</th>
                              <th className="text-right px-4 py-2 w-24">크기</th>
                              <th className="text-right px-4 py-2 w-32">수신 시각</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.recentMessages.map((m) => (
                              <tr key={m.uid} className="border-t border-gray-100">
                                <td className="px-4 py-2">
                                  {m.seen ? <MailOpen size={14} className="text-gray-400" /> : <Mail size={14} className="text-primary-600" />}
                                </td>
                                <td className="px-4 py-2 text-gray-700">
                                  <div className="truncate max-w-[200px]" title={m.from ?? ''}>
                                    {m.from ?? '(알 수 없음)'}
                                  </div>
                                </td>
                                <td className="px-4 py-2">
                                  <div className={`truncate max-w-md ${!m.seen ? 'font-semibold' : ''}`} title={m.subject ?? ''}>
                                    {m.subject ?? '(제목 없음)'}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right text-xs text-gray-500">
                                  {formatSize(m.size)}
                                </td>
                                <td className="px-4 py-2 text-right text-xs text-gray-500">
                                  {formatDate(m.date)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {result.ok && (!result.recentMessages || result.recentMessages.length === 0) && (
                      <div className="px-4 py-6 text-center text-sm text-gray-500">
                        INBOX에 메일이 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
