import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Mail, Inbox, Send, Star, Trash2, Archive, Plus, Search,
  RefreshCw, ChevronLeft, Paperclip, X,
  Reply, Forward, AlertCircle, Loader2,
} from 'lucide-react';
import { api } from '../services/api';
import { sanitizeHtml } from '../utils/sanitize';

/* ───────── 타입 ───────── */

interface MailAccount {
  id: string;
  email: string;
  displayName: string;
  imapHost: string;
  smtpHost: string;
  quotaMB: number;
  usedMB: number;
  isActive: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
}

interface MailListItem {
  uid: string;
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  to: { email: string; name?: string }[];
  snippet: string;
  sentAt: string;
  isSeen: boolean;
  isFlagged: boolean;
  hasAttachment: boolean;
  size: number;
}

interface MailDetail extends MailListItem {
  html: string | null;
  text: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    index: number;
  }>;
}

interface FolderInfo {
  name: string;
  path: string;
  specialUse?: string;
  unseen: number;
  total: number;
}

/* ───────── 폴더 매핑 (WorkMail/IMAP 표준) ───────── */

// specialUse → UI 라벨/아이콘
const FOLDER_META: Record<string, { label: string; icon: any; priority: number }> = {
  '\\Inbox':   { label: '받은편지함', icon: Inbox,   priority: 1 },
  '\\Sent':    { label: '보낸편지함', icon: Send,    priority: 2 },
  '\\Drafts':  { label: '임시보관',   icon: Mail,    priority: 3 },
  '\\Flagged': { label: '중요',       icon: Star,    priority: 4 },
  '\\Junk':    { label: '스팸',       icon: AlertCircle, priority: 5 },
  '\\Archive': { label: '보관',       icon: Archive, priority: 6 },
  '\\Trash':   { label: '휴지통',     icon: Trash2,  priority: 7 },
};

const PATH_FALLBACK_META: Record<string, { label: string; icon: any; priority: number }> = {
  INBOX: { label: '받은편지함', icon: Inbox, priority: 1 },
  Sent: { label: '보낸편지함', icon: Send, priority: 2 },
  Drafts: { label: '임시보관', icon: Mail, priority: 3 },
  'Deleted Messages': { label: '휴지통', icon: Trash2, priority: 7 },
  Trash: { label: '휴지통', icon: Trash2, priority: 7 },
  'Junk E-mail': { label: '스팸', icon: AlertCircle, priority: 5 },
};

function folderMeta(f: FolderInfo) {
  if (f.specialUse && FOLDER_META[f.specialUse]) return FOLDER_META[f.specialUse];
  return PATH_FALLBACK_META[f.path] ?? { label: f.name, icon: Mail, priority: 99 };
}

/* ═══════════════════════════════════════════════════════
   메인 컴포넌트
   ═══════════════════════════════════════════════════════ */

export default function MailPage() {
  const [account, setAccount] = useState<MailAccount | null | 'loading'>('loading');
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>('INBOX');
  const [messages, setMessages] = useState<MailListItem[]>([]);
  const [messagesMeta, setMessagesMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [selectedMail, setSelectedMail] = useState<MailDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const searchTimerRef = useRef<number | null>(null);

  /* ───── 초기 로드 ───── */
  const fetchAccount = useCallback(async () => {
    try {
      const { data } = await api.get('/mail/account');
      setAccount(data.data);
    } catch (err: any) {
      setAccount(null);
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const { data } = await api.get('/mail/folders');
      const list: FolderInfo[] = data.data || [];
      list.sort((a, b) => folderMeta(a).priority - folderMeta(b).priority);
      setFolders(list);
    } catch {
      setFolders([]);
    }
  }, []);

  const fetchMessages = useCallback(
    async (folder: string, page = 1, search = '') => {
      setLoadingMessages(true);
      setErrorMsg(null);
      try {
        const { data } = await api.get('/mail/messages', {
          params: { folder, page, limit: 20, search: search || undefined },
        });
        setMessages(data.data || []);
        setMessagesMeta(
          data.meta
            ? { total: data.meta.total, page: data.meta.page, totalPages: data.meta.totalPages }
            : { total: 0, page: 1, totalPages: 1 },
        );
      } catch (err: any) {
        setMessages([]);
        setErrorMsg(err?.response?.data?.error?.message || '메일을 불러올 수 없습니다');
      } finally {
        setLoadingMessages(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  useEffect(() => {
    if (account && account !== 'loading') {
      fetchFolders();
      fetchMessages(currentFolder);
    }
  }, [account, currentFolder, fetchFolders, fetchMessages]);

  // 검색어 디바운스 (500ms)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      if (account && account !== 'loading') fetchMessages(currentFolder, 1, searchQuery);
    }, 500);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  /* ───── 메일 선택 ───── */
  const handleSelectMail = async (m: MailListItem) => {
    setLoadingDetail(true);
    try {
      const { data } = await api.get(`/mail/messages/${encodeURIComponent(m.uid)}`, {
        params: { folder: currentFolder },
      });
      setSelectedMail(data.data);
      // 목록에서 읽음 처리 반영
      setMessages((prev) => prev.map((x) => (x.uid === m.uid ? { ...x, isSeen: true } : x)));
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '메일 본문을 불러올 수 없습니다');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleToggleStar = async (uid: string, current: boolean) => {
    try {
      await api.patch(`/mail/messages/${encodeURIComponent(uid)}/flags`, {
        folder: currentFolder,
        flagged: !current,
      });
      setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, isFlagged: !current } : m)));
      if (selectedMail?.uid === uid) {
        setSelectedMail({ ...selectedMail, isFlagged: !current });
      }
    } catch {
      /* silent */
    }
  };

  const handleDelete = async (uid: string) => {
    if (!confirm('휴지통으로 이동하시겠습니까?')) return;
    try {
      await api.delete(`/mail/messages/${encodeURIComponent(uid)}`, {
        params: { folder: currentFolder },
      });
      setMessages((prev) => prev.filter((m) => m.uid !== uid));
      setSelectedMail(null);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제 실패');
    }
  };

  const handleRefresh = () => {
    fetchMessages(currentFolder, messagesMeta.page, searchQuery);
  };

  /* ───── 렌더링 분기 ───── */

  if (account === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
        <Loader2 size={24} className="animate-spin mr-2" />
        메일 계정 확인 중...
      </div>
    );
  }

  if (!account) {
    return <NotLinkedScreen />;
  }

  return (
    <div className="h-full flex">
      {/* ─── 좌측 사이드바 ─── */}
      <div className="w-52 border-r border-gray-100 dark:border-slate-700 flex flex-col bg-white/50 dark:bg-slate-800/40">
        <div className="p-3">
          <button
            onClick={() => setShowCompose(true)}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
          >
            <Plus size={16} /> 메일 쓰기
          </button>
        </div>

        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {folders.map((f) => {
            const meta = folderMeta(f);
            const active = f.path === currentFolder;
            return (
              <button
                key={f.path}
                onClick={() => {
                  setCurrentFolder(f.path);
                  setSelectedMail(null);
                  setMessagesMeta({ ...messagesMeta, page: 1 });
                }}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <meta.icon size={16} />
                <span className="flex-1 text-left truncate">{meta.label}</span>
                {f.unseen > 0 && (
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                    {f.unseen}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 계정 요약 */}
        <div className="p-3 border-t border-gray-100 dark:border-slate-700">
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${account.isActive ? 'bg-green-500' : 'bg-red-400'}`} />
              <span className="truncate">{account.email}</span>
            </div>
            <div className="text-[11px] opacity-70">
              {account.usedMB.toFixed(1)}MB / {(account.quotaMB / 1024).toFixed(1)}GB
            </div>
            {account.lastSyncError && (
              <div className="text-[11px] text-red-500 mt-1">동기화 오류: {account.lastSyncError.slice(0, 60)}</div>
            )}
          </div>
        </div>
      </div>

      {/* ─── 오른쪽 메인 ─── */}
      {selectedMail ? (
        <MailDetailView
          mail={selectedMail}
          folder={currentFolder}
          loading={loadingDetail}
          onBack={() => setSelectedMail(null)}
          onToggleStar={() => handleToggleStar(selectedMail.uid, selectedMail.isFlagged)}
          onDelete={() => handleDelete(selectedMail.uid)}
          onReply={() => setShowCompose(true)}
        />
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <div className="flex items-center gap-2 flex-1 bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
              <Search size={16} className="text-gray-400" />
              <input
                type="text"
                className="bg-transparent text-sm outline-none flex-1 dark:text-gray-200"
                placeholder="메일 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              onClick={handleRefresh}
              disabled={loadingMessages}
              className="p-2 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg text-gray-400 dark:text-gray-500"
              title="새로고침"
            >
              <RefreshCw size={16} className={loadingMessages ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {errorMsg ? (
              <div className="flex flex-col items-center justify-center h-full text-red-500 p-4 text-center">
                <AlertCircle size={32} className="mb-3 opacity-60" />
                <p className="text-sm">{errorMsg}</p>
                <button onClick={handleRefresh} className="mt-3 text-primary-600 text-xs underline">
                  다시 시도
                </button>
              </div>
            ) : loadingMessages && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                불러오는 중...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Mail size={40} className="mb-3 opacity-30" />
                <p className="text-sm">메일이 없습니다</p>
              </div>
            ) : (
              messages.map((m) => (
                <MailListRow
                  key={m.uid}
                  mail={m}
                  currentFolder={currentFolder}
                  onSelect={() => handleSelectMail(m)}
                  onToggleStar={() => handleToggleStar(m.uid, m.isFlagged)}
                />
              ))
            )}
          </div>

          {/* 페이지네이션 */}
          {messagesMeta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-slate-700 text-xs text-gray-500">
              <span>
                {(messagesMeta.page - 1) * 20 + 1}-
                {Math.min(messagesMeta.page * 20, messagesMeta.total)} / {messagesMeta.total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={messagesMeta.page <= 1 || loadingMessages}
                  onClick={() => fetchMessages(currentFolder, messagesMeta.page - 1, searchQuery)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>{messagesMeta.page} / {messagesMeta.totalPages}</span>
                <button
                  disabled={messagesMeta.page >= messagesMeta.totalPages || loadingMessages}
                  onClick={() => fetchMessages(currentFolder, messagesMeta.page + 1, searchQuery)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded disabled:opacity-30"
                >
                  <ChevronLeft size={14} className="rotate-180" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 작성 모달 */}
      {showCompose && (
        <ComposeModal
          replyTo={selectedMail}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); handleRefresh(); }}
        />
      )}
    </div>
  );
}

/* ═══════════ 계정 미연결 안내 화면 ═══════════ */
function NotLinkedScreen() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <Mail size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
          메일 계정이 아직 연결되지 않았습니다
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          관리자가 WorkMail 계정을 생성하고 연결해야 메일을 사용할 수 있습니다.<br />
          관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
}

/* ═══════════ 메일 목록 행 ═══════════ */
function MailListRow({
  mail, currentFolder, onSelect, onToggleStar,
}: {
  mail: MailListItem;
  currentFolder: string;
  onSelect: () => void;
  onToggleStar: () => void;
}) {
  const fmt = (d: string) => {
    const dt = new Date(d);
    const today = new Date();
    return dt.toDateString() === today.toDateString()
      ? dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const isSent = currentFolder === 'Sent' || currentFolder.toLowerCase().includes('sent');
  const displayName = isSent
    ? `To: ${mail.to[0]?.name || mail.to[0]?.email || ''}`
    : (mail.fromName || mail.fromEmail);

  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-slate-700/60 cursor-pointer transition-colors hover:bg-primary-50/30 dark:hover:bg-slate-700/40 ${
        !mail.isSeen ? 'bg-primary-50/20 dark:bg-slate-700/20' : ''
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5">
        {(mail.fromName?.[0] || mail.fromEmail[0] || '?').toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-sm truncate ${!mail.isSeen ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
            {displayName}
          </span>
          <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{fmt(mail.sentAt)}</span>
        </div>
        <p className={`text-sm truncate ${!mail.isSeen ? 'font-semibold text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
          {mail.subject || '(제목 없음)'}
        </p>
      </div>
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <button onClick={(e) => { e.stopPropagation(); onToggleStar(); }} className="p-0.5">
          {mail.isFlagged
            ? <Star size={14} className="fill-yellow-400 text-yellow-400" />
            : <Star size={14} className="text-gray-300 hover:text-yellow-400" />}
        </button>
        {mail.hasAttachment && <Paperclip size={12} className="text-gray-300" />}
        {!mail.isSeen && <div className="w-2 h-2 rounded-full bg-primary-500" />}
      </div>
    </div>
  );
}

/* ═══════════ 메일 상세 ═══════════ */
function MailDetailView({
  mail, folder, loading, onBack, onToggleStar, onDelete, onReply,
}: {
  mail: MailDetail;
  folder: string;
  loading: boolean;
  onBack: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onReply: () => void;
}) {
  const formatDate = (d: string) =>
    new Date(d).toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const downloadAttachment = async (att: MailDetail['attachments'][number]) => {
    try {
      const res = await api.get(
        `/mail/messages/${encodeURIComponent(mail.uid)}/attachments/${att.index}`,
        { params: { folder }, responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '다운로드 실패');
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1" />
        <button onClick={onToggleStar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400">
          {mail.isFlagged ? <Star size={16} className="fill-yellow-400 text-yellow-400" /> : <Star size={16} />}
        </button>
        <button onClick={onReply} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400" title="답장">
          <Reply size={16} />
        </button>
        <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400" title="전달">
          <Forward size={16} />
        </button>
        <button onClick={onDelete} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500" title="삭제">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            불러오는 중...
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3">
              {mail.subject || '(제목 없음)'}
            </h2>
            <div className="flex items-start gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                {(mail.fromName?.[0] || mail.fromEmail[0] || '?').toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                  <span className="font-semibold">{mail.fromName || mail.fromEmail}</span>
                  {mail.fromName && <span className="text-xs text-gray-400">&lt;{mail.fromEmail}&gt;</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  받는사람: {mail.to.map((t) => t.name || t.email).join(', ')}
                </p>
                <p className="text-xs text-gray-400">{formatDate(mail.sentAt)}</p>
              </div>
            </div>

            {mail.attachments.length > 0 && (
              <div className="space-y-1.5 mb-4">
                {mail.attachments.map((att) => (
                  <div key={att.index} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-700/50 rounded-xl text-sm">
                    <Paperclip size={14} className="text-gray-400" />
                    <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{att.filename}</span>
                    <span className="text-xs text-gray-400">{(att.size / 1024).toFixed(1)}KB</span>
                    <button
                      onClick={() => downloadAttachment(att)}
                      className="text-primary-600 hover:underline text-xs"
                    >
                      다운로드
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 본문 — HTML이면 sanitize 후 렌더, 아니면 plain text */}
            {mail.html ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(mail.html) }}
              />
            ) : (
              <div className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 leading-relaxed">
                {mail.text || '(본문 없음)'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════ 메일 작성 모달 ═══════════ */
function ComposeModal({
  replyTo, onClose, onSent,
}: {
  replyTo: MailDetail | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(replyTo ? replyTo.fromEmail : '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : '');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const MAX_TOTAL = 100 * 1024 * 1024; // 100MB
  const overLimit = totalSize > MAX_TOTAL;

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 10);
    setFiles(next);
  };

  const handleSend = async () => {
    setError(null);
    if (!to.trim()) { setError('받는 사람을 입력하세요'); return; }
    if (!subject.trim()) { setError('제목을 입력하세요'); return; }
    if (!body.trim()) { setError('본문을 입력하세요'); return; }
    if (overLimit) { setError('첨부파일 총 크기가 100MB를 초과합니다'); return; }

    setSending(true);
    try {
      const form = new FormData();
      form.append('to', to);
      if (cc) form.append('cc', cc);
      form.append('subject', subject);
      form.append('text', body);
      files.forEach((f) => form.append('attachments', f));

      await api.post('/mail/send', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSent();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '발송 실패');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">새 메일</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={sending || overLimit}
              className="btn-primary py-1.5 px-4 text-sm flex items-center gap-1 disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? '전송 중...' : '보내기'}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-12">받는이</span>
            <input
              type="email" value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com (콤마로 구분)"
              className="flex-1 border-b border-gray-200 dark:border-slate-700 py-1.5 text-sm outline-none focus:border-primary-500 bg-transparent dark:text-gray-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-12">참조</span>
            <input
              type="text" value={cc} onChange={(e) => setCc(e.target.value)}
              placeholder="(선택)"
              className="flex-1 border-b border-gray-200 dark:border-slate-700 py-1.5 text-sm outline-none focus:border-primary-500 bg-transparent dark:text-gray-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-12">제목</span>
            <input
              type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="메일 제목"
              className="flex-1 border-b border-gray-200 dark:border-slate-700 py-1.5 text-sm outline-none focus:border-primary-500 bg-transparent dark:text-gray-200"
            />
          </div>

          <textarea
            className="w-full h-64 border border-gray-200 dark:border-slate-700 rounded-xl p-3 text-sm outline-none focus:border-primary-500 resize-none bg-transparent dark:text-gray-200"
            placeholder="내용을 입력하세요..."
            value={body} onChange={(e) => setBody(e.target.value)}
          />

          {/* 첨부 영역 */}
          <div>
            <label className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600 cursor-pointer">
              <Paperclip size={14} />
              파일 첨부
              <input
                type="file" multiple onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
            </label>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <Paperclip size={11} />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-gray-400">{(f.size / 1024 / 1024).toFixed(2)}MB</span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className={`text-xs mt-1 ${overLimit ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                  총 {(totalSize / 1024 / 1024).toFixed(2)}MB / 100MB
                  {overLimit && ' — 한도 초과!'}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
