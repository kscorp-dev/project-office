import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Paperclip, X } from 'lucide-react';
import { useMailRealtime } from '../store/mailRealtime';
import { useAuthStore } from '../store/auth';

/**
 * 전역 메일 알림 토스트 + 소켓 연결 관리
 *
 * 동작:
 *  - 로그인 상태면 소켓 연결, 로그아웃하면 끊음
 *  - 새 메일 도착 시 화면 우상단에 토스트 (최대 3개)
 *  - 각 토스트 5초 후 자동 사라짐 (수동 dismiss도 가능)
 *  - 클릭하면 /mail 페이지로 이동
 */
export default function MailNotifications() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const notifications = useMailRealtime((s) => s.latestNotifications);
  const dismiss = useMailRealtime((s) => s.dismissNotification);
  const connect = useMailRealtime((s) => s.connect);
  const disconnect = useMailRealtime((s) => s.disconnect);

  // 로그인 상태와 소켓 동기화
  useEffect(() => {
    if (accessToken) {
      connect();
      // 브라우저 Notification 권한 요청 (이미 granted/denied면 no-op)
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => { /* ignore */ });
      }
    } else {
      disconnect();
    }
  }, [accessToken, connect, disconnect]);

  // 각 알림 5초 후 자동 dismiss
  useEffect(() => {
    if (notifications.length === 0) return;
    const timers = notifications.map((n) =>
      setTimeout(() => dismiss(n.id), 5000),
    );
    return () => timers.forEach(clearTimeout);
  }, [notifications, dismiss]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] space-y-2 pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          role="alert"
          className="pointer-events-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl p-3 w-80 flex items-start gap-3 animate-in slide-in-from-right cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/80 transition-colors"
          onClick={() => { dismiss(n.id); navigate('/mail'); }}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0">
            <Mail size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">새 메일 도착</span>
              <button
                onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                className="p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate mt-0.5">
              {n.fromName || n.fromEmail}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 truncate flex items-center gap-1">
              {n.hasAttachment && <Paperclip size={10} className="flex-shrink-0" />}
              {n.subject || '(제목 없음)'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
