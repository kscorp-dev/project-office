import { useState } from 'react';
import {
  Mail, Inbox, Send, Star, Trash2, Archive, Plus, Search,
  Settings, RefreshCw, ChevronLeft, Paperclip, X,
  Reply, Forward,
  Check, AlertCircle,
} from 'lucide-react';

/* ── 타입 ── */
interface MailAccount {
  id: string;
  email: string;
  name: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  useSsl: boolean;
  isConnected: boolean;
}

interface MailMessage {
  id: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  body: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  folder: 'inbox' | 'sent' | 'starred' | 'trash' | 'archive';
}

type Folder = 'inbox' | 'sent' | 'starred' | 'trash' | 'archive';

const FOLDERS: { key: Folder; label: string; icon: any }[] = [
  { key: 'inbox',   label: '받은편지함', icon: Inbox },
  { key: 'sent',    label: '보낸편지함', icon: Send },
  { key: 'starred', label: '중요',       icon: Star },
  { key: 'archive', label: '보관함',     icon: Archive },
  { key: 'trash',   label: '휴지통',     icon: Trash2 },
];

/* ── 데모 메일 데이터 ── */
const DEMO_MAILS: MailMessage[] = [
  {
    id: 'm1', from: { name: '김부장', email: 'kim@kscorp.kr' },
    to: [{ name: '나', email: 'me@kscorp.kr' }],
    subject: '4월 프로젝트 진행 현황 보고 요청',
    body: '안녕하세요,\n\n4월 프로젝트 진행 현황에 대한 보고서를 이번 주 금요일까지 제출 부탁드립니다.\n\n각 팀별 진척도, 이슈 사항, 다음 주 계획을 포함해 주세요.\n\n감사합니다.\n김부장 드림',
    date: '2026-04-09T09:30:00', isRead: false, isStarred: true, hasAttachment: false, folder: 'inbox',
  },
  {
    id: 'm2', from: { name: '이대리', email: 'lee@kscorp.kr' },
    to: [{ name: '나', email: 'me@kscorp.kr' }],
    subject: 'Re: 화상회의 시스템 테스트 결과',
    body: '테스트 결과 공유드립니다.\n\n1. 음성 인식 정확도: 약 92%\n2. 화면 공유 지연: 0.5초 이내\n3. 최대 동시 접속: 20명 테스트 완료\n\n상세 리포트는 첨부파일 확인 부탁드립니다.',
    date: '2026-04-09T08:15:00', isRead: false, isStarred: false, hasAttachment: true, folder: 'inbox',
  },
  {
    id: 'm3', from: { name: '박과장', email: 'park@kscorp.kr' },
    to: [{ name: '나', email: 'me@kscorp.kr' }],
    subject: '자재관리 시스템 업데이트 안내',
    body: '자재관리 시스템이 v2.1로 업데이트되었습니다.\n\n주요 변경사항:\n- 재고 자동 알림 기능 추가\n- 바코드 스캔 개선\n- 보고서 양식 변경',
    date: '2026-04-08T16:45:00', isRead: true, isStarred: false, hasAttachment: false, folder: 'inbox',
  },
  {
    id: 'm4', from: { name: '최사원', email: 'choi@kscorp.kr' },
    to: [{ name: '나', email: 'me@kscorp.kr' }],
    subject: '신입사원 교육 일정 안내',
    body: '4월 신입사원 교육 일정을 안내드립니다.\n\n일시: 4/14(월) ~ 4/18(금)\n장소: 본사 3층 대회의실\n대상: 2026년 상반기 신입사원 5명',
    date: '2026-04-08T14:20:00', isRead: true, isStarred: false, hasAttachment: true, folder: 'inbox',
  },
  {
    id: 'm5', from: { name: '나', email: 'me@kscorp.kr' },
    to: [{ name: '김부장', email: 'kim@kscorp.kr' }],
    subject: '3월 실적 보고서 제출',
    body: '김부장님,\n\n3월 실적 보고서 제출합니다.\n첨부파일 확인 부탁드립니다.\n\n감사합니다.',
    date: '2026-04-07T17:00:00', isRead: true, isStarred: false, hasAttachment: true, folder: 'sent',
  },
  {
    id: 'm6', from: { name: '정차장', email: 'jung@kscorp.kr' },
    to: [{ name: '나', email: 'me@kscorp.kr' }],
    subject: '연차 사용 승인 완료',
    body: '신청하신 연차가 승인되었습니다.\n\n사용일: 4/21(월)\n잔여 연차: 12일',
    date: '2026-04-07T11:30:00', isRead: true, isStarred: true, hasAttachment: false, folder: 'inbox',
  },
];

/* ── 회사 메일 설정 모달 ── */
function MailSettingsModal({
  account,
  onSave,
  onClose,
}: {
  account: MailAccount | null;
  onSave: (acc: MailAccount) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<MailAccount>(
    account || {
      id: '', email: '', name: '',
      imapHost: 'imap.kscorp.kr', imapPort: 993,
      smtpHost: 'smtp.kscorp.kr', smtpPort: 587,
      useSsl: true, isConnected: false,
    }
  );
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    await new Promise(r => setTimeout(r, 1500));
    setTestResult(form.email && password ? 'success' : 'error');
    setTesting(false);
  };

  const handleSave = () => {
    onSave({ ...form, id: form.id || `acc-${Date.now()}`, isConnected: testResult === 'success' });
  };

  const update = (key: keyof MailAccount, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-lg">회사 메일 연결</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          {/* 안내 */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-primary-50 rounded-xl text-xs text-primary-700">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>회사에서 발급한 메일 계정 정보를 입력하세요. 메일 서버 정보는 IT 관리자에게 문의하세요.</span>
          </div>

          {/* 기본 입력 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">이름 (발신자 표시명)</label>
            <input
              type="text"
              className="input-field"
              placeholder="홍길동"
              value={form.name}
              onChange={e => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">회사 이메일</label>
            <input
              type="email"
              className="input-field"
              placeholder="hong@kscorp.kr"
              value={form.email}
              onChange={e => update('email', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">비밀번호</label>
            <input
              type="password"
              className="input-field"
              placeholder="메일 비밀번호 입력"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {/* 고급 설정 토글 (관리자용) */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-gray-400 hover:text-primary-600 flex items-center gap-1"
          >
            <Settings size={12} />
            {showAdvanced ? '서버 설정 숨기기' : '서버 설정 직접 변경 (관리자용)'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-3 border-l-2 border-primary-100">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">수신 서버 (IMAP)</label>
                <div className="grid grid-cols-3 gap-2">
                  <input className="input-field col-span-2" placeholder="imap.kscorp.kr" value={form.imapHost} onChange={e => update('imapHost', e.target.value)} />
                  <input className="input-field" type="number" placeholder="993" value={form.imapPort} onChange={e => update('imapPort', Number(e.target.value))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">발신 서버 (SMTP)</label>
                <div className="grid grid-cols-3 gap-2">
                  <input className="input-field col-span-2" placeholder="smtp.kscorp.kr" value={form.smtpHost} onChange={e => update('smtpHost', e.target.value)} />
                  <input className="input-field" type="number" placeholder="587" value={form.smtpPort} onChange={e => update('smtpPort', Number(e.target.value))} />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.useSsl} onChange={e => update('useSsl', e.target.checked)} className="w-4 h-4 text-primary-600 rounded border-gray-300" />
                <span className="text-sm text-gray-700">SSL/TLS 사용</span>
              </label>
            </div>
          )}

          {/* 테스트 결과 */}
          {testResult && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${
              testResult === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {testResult === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
              {testResult === 'success' ? '연결 성공! 회사 메일을 사용할 수 있습니다.' : '연결 실패. 이메일과 비밀번호를 확인해주세요.'}
            </div>
          )}

          {/* 버튼 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleTest}
              disabled={testing || !form.email || !password}
              className="btn-secondary flex items-center gap-1 flex-1 justify-center"
            >
              {testing ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
              {testing ? '연결 중...' : '연결 테스트'}
            </button>
            <button
              onClick={handleSave}
              disabled={!form.email || !password}
              className="btn-primary flex-1"
            >
              연결하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 메일 작성 모달 ── */
function ComposeModal({ onClose, onSend }: { onClose: () => void; onSend: (mail: Partial<MailMessage>) => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const handleSend = () => {
    if (!to || !subject) return;
    onSend({
      to: [{ name: to, email: to }],
      subject,
      body,
      date: new Date().toISOString(),
      folder: 'sent',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-800">새 메일</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleSend} disabled={!to || !subject} className="btn-primary py-1.5 px-4 text-sm flex items-center gap-1">
              <Send size={14} /> 보내기
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-12">받는이</span>
            <input
              type="email"
              className="flex-1 border-b border-gray-200 py-1.5 text-sm outline-none focus:border-primary-500"
              placeholder="recipient@example.com"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-12">제목</span>
            <input
              type="text"
              className="flex-1 border-b border-gray-200 py-1.5 text-sm outline-none focus:border-primary-500"
              placeholder="메일 제목"
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>
          <textarea
            className="w-full h-64 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-primary-500 resize-none"
            placeholder="내용을 입력하세요..."
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600">
              <Paperclip size={14} /> 파일 첨부
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 메일 상세 보기 ── */
function MailDetail({
  mail,
  onBack,
  onToggleStar,
  onDelete,
}: {
  mail: MailMessage;
  onBack: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const formatDate = (d: string) =>
    new Date(d).toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="flex-1 flex flex-col">
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1" />
        <button onClick={onToggleStar} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
          {mail.isStarred ? <Star size={16} className="fill-yellow-400 text-yellow-400" /> : <Star size={16} />}
        </button>
        <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Reply size={16} /></button>
        <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Forward size={16} /></button>
        <button onClick={onDelete} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <h2 className="text-xl font-bold text-gray-800 mb-3">{mail.subject}</h2>
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {mail.from.name[0]}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-800">{mail.from.name}</span>
              <span className="text-xs text-gray-400">&lt;{mail.from.email}&gt;</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              받는사람: {mail.to.map(t => t.name || t.email).join(', ')}
            </p>
            <p className="text-xs text-gray-400">{formatDate(mail.date)}</p>
          </div>
        </div>

        {mail.hasAttachment && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl mb-4 text-sm text-gray-600">
            <Paperclip size={14} />
            <span>첨부파일 1개</span>
            <button className="ml-auto text-primary-600 hover:underline text-xs">다운로드</button>
          </div>
        )}

        <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
          {mail.body}
        </div>
      </div>
    </div>
  );
}

/* ── 메인 Mail 페이지 ── */
export default function MailPage() {
  const [currentFolder, setCurrentFolder] = useState<Folder>('inbox');
  const [mails, setMails] = useState<MailMessage[]>(DEMO_MAILS);
  const [selectedMail, setSelectedMail] = useState<MailMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [account, setAccount] = useState<MailAccount | null>(null);

  // 폴더별 필터
  const filteredMails = mails.filter(m => {
    if (currentFolder === 'starred') return m.isStarred;
    return m.folder === currentFolder;
  }).filter(m =>
    !searchQuery || m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.from.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const unreadCount = mails.filter(m => m.folder === 'inbox' && !m.isRead).length;

  const handleSelectMail = (mail: MailMessage) => {
    setSelectedMail(mail);
    if (!mail.isRead) {
      setMails(prev => prev.map(m => m.id === mail.id ? { ...m, isRead: true } : m));
    }
  };

  const handleToggleStar = (id: string) => {
    setMails(prev => prev.map(m => m.id === id ? { ...m, isStarred: !m.isStarred } : m));
    if (selectedMail?.id === id) {
      setSelectedMail(prev => prev ? { ...prev, isStarred: !prev.isStarred } : null);
    }
  };

  const handleDelete = (id: string) => {
    setMails(prev => prev.map(m => m.id === id ? { ...m, folder: 'trash' as Folder } : m));
    setSelectedMail(null);
  };

  const handleSend = (mail: Partial<MailMessage>) => {
    const newMail: MailMessage = {
      id: `m-${Date.now()}`,
      from: { name: account?.name || '나', email: account?.email || 'me@kscorp.kr' },
      to: mail.to || [],
      subject: mail.subject || '(제목 없음)',
      body: mail.body || '',
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      hasAttachment: false,
      folder: 'sent',
    };
    setMails(prev => [newMail, ...prev]);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full flex">
      {/* 좌측 폴더 목록 */}
      <div className="w-52 border-r border-gray-100 flex flex-col bg-white/50">
        <div className="p-3">
          <button
            onClick={() => setShowCompose(true)}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
          >
            <Plus size={16} /> 메일 쓰기
          </button>
        </div>

        <nav className="flex-1 px-2 space-y-0.5">
          {FOLDERS.map(f => {
            const count = f.key === 'inbox' ? unreadCount :
                         f.key === 'starred' ? mails.filter(m => m.isStarred).length : 0;
            return (
              <button
                key={f.key}
                onClick={() => { setCurrentFolder(f.key); setSelectedMail(null); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm transition-colors ${
                  currentFolder === f.key
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <f.icon size={16} />
                <span className="flex-1 text-left">{f.label}</span>
                {count > 0 && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                    f.key === 'inbox' ? 'bg-primary-100 text-primary-700' : 'text-gray-400'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 계정 설정 */}
        <div className="p-3 border-t border-gray-100">
          {account ? (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-gray-500 hover:bg-gray-50"
            >
              <div className={`w-2 h-2 rounded-full ${account.isConnected ? 'bg-green-500' : 'bg-red-400'}`} />
              <span className="truncate">{account.email}</span>
              <Settings size={12} className="ml-auto" />
            </button>
          ) : (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs text-primary-600 hover:bg-primary-50 font-medium"
            >
              <Settings size={14} />
              메일 계정 설정
            </button>
          )}
        </div>
      </div>

      {/* 메일 목록 또는 상세 */}
      {selectedMail ? (
        <MailDetail
          mail={selectedMail}
          onBack={() => setSelectedMail(null)}
          onToggleStar={() => handleToggleStar(selectedMail.id)}
          onDelete={() => handleDelete(selectedMail.id)}
        />
      ) : (
        <div className="flex-1 flex flex-col">
          {/* 검색 바 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 flex-1 bg-gray-50 rounded-xl px-3 py-2">
              <Search size={16} className="text-gray-400" />
              <input
                type="text"
                className="bg-transparent text-sm outline-none flex-1"
                placeholder="메일 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="p-2 hover:bg-gray-50 rounded-lg text-gray-400">
              <RefreshCw size={16} />
            </button>
          </div>

          {/* 메일 리스트 */}
          <div className="flex-1 overflow-y-auto">
            {filteredMails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Mail size={40} className="mb-3 opacity-30" />
                <p className="text-sm">메일이 없습니다</p>
              </div>
            ) : (
              filteredMails.map(mail => (
                <div
                  key={mail.id}
                  onClick={() => handleSelectMail(mail)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors hover:bg-primary-50/30 ${
                    !mail.isRead ? 'bg-primary-50/20' : ''
                  }`}
                >
                  {/* 아바타 */}
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5">
                    {mail.from.name[0]}
                  </div>

                  {/* 내용 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-sm truncate ${!mail.isRead ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                        {currentFolder === 'sent' ? `To: ${mail.to[0]?.name || mail.to[0]?.email}` : mail.from.name}
                      </span>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{formatDate(mail.date)}</span>
                    </div>
                    <p className={`text-sm truncate ${!mail.isRead ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                      {mail.subject}
                    </p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{mail.body.split('\n')[0]}</p>
                  </div>

                  {/* 인디케이터 */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); handleToggleStar(mail.id); }}
                      className="p-0.5"
                    >
                      {mail.isStarred ? (
                        <Star size={14} className="fill-yellow-400 text-yellow-400" />
                      ) : (
                        <Star size={14} className="text-gray-300 hover:text-yellow-400" />
                      )}
                    </button>
                    {mail.hasAttachment && <Paperclip size={12} className="text-gray-300" />}
                    {!mail.isRead && <div className="w-2 h-2 rounded-full bg-primary-500" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 모달들 */}
      {showSettings && (
        <MailSettingsModal
          account={account}
          onSave={acc => { setAccount(acc); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showCompose && (
        <ComposeModal
          onClose={() => setShowCompose(false)}
          onSend={handleSend}
        />
      )}
    </div>
  );
}
