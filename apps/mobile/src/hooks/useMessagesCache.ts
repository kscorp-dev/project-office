/**
 * 메신저 룸 메시지의 오프라인 캐시 — useChatRooms 와 동일 패턴.
 *
 * 흐름:
 *   1) 마운트 시 SQLite chat_messages 에서 룸별 최근 50건 즉시 로드 (UI 빠르게)
 *   2) 동시에 GET /messenger/rooms/:id/messages?limit=50
 *   3) 서버 응답 → 캐시 upsert + UI 갱신
 *   4) 네트워크 실패 시 캐시 유지 + isOffline=true (호출자가 배너 표시)
 *
 * 정책:
 *   - 캐시는 룸당 최근 200건까지 (offline-db.pruneOfflineDb 가 정리)
 *   - 새 메시지가 socket 으로 도착하면 호출자가 appendMessage 로 캐시에 추가
 *   - is_deleted=true 메시지는 캐시에서도 표시하되 content 는 비움
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { eq, and, desc } from 'drizzle-orm';
import api from '../services/api';
import { db } from '../offline-db';
import { chatMessages } from '../offline-db/schema';

export interface UiMessage {
  id: string;
  roomId: string;
  senderId: string | null;
  senderName: string | null;
  type: 'text' | 'image' | 'file' | 'system';
  content: string | null;
  attachmentUrl: string | null;
  createdAt: number; // unix ms
  isDeleted?: boolean;
}

interface ServerMessage {
  id: string;
  roomId: string;
  senderId?: string | null;
  sender?: { id: string; name: string } | null;
  type: 'text' | 'image' | 'file' | 'system';
  content?: string | null;
  fileUrl?: string | null;
  attachmentUrl?: string | null;
  isDeleted?: boolean;
  createdAt: string;
}

function normalizeServer(m: ServerMessage): UiMessage {
  return {
    id: m.id,
    roomId: m.roomId,
    senderId: m.senderId ?? m.sender?.id ?? null,
    senderName: m.sender?.name ?? null,
    type: m.type,
    content: m.isDeleted ? '(삭제된 메시지)' : (m.content ?? null),
    attachmentUrl: m.attachmentUrl ?? m.fileUrl ?? null,
    createdAt: new Date(m.createdAt).getTime(),
    isDeleted: !!m.isDeleted,
  };
}

async function loadFromCache(roomId: string, limit = 50): Promise<UiMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  // 시간 오름차순 (UI 가 위→아래로 오래된→최신)
  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      roomId: r.roomId,
      senderId: r.senderId ?? null,
      senderName: r.senderName ?? null,
      type: (r.type as UiMessage['type']) ?? 'text',
      content: r.content ?? null,
      attachmentUrl: r.attachmentUrl ?? null,
      createdAt: r.createdAt ?? 0,
    }));
}

async function upsertToCache(messages: UiMessage[]) {
  if (messages.length === 0) return;
  await db.transaction(async (tx) => {
    for (const m of messages) {
      await tx
        .insert(chatMessages)
        .values({
          id: m.id,
          roomId: m.roomId,
          senderId: m.senderId,
          senderName: m.senderName,
          type: m.type,
          content: m.content,
          attachmentUrl: m.attachmentUrl,
          createdAt: m.createdAt,
        })
        .onConflictDoUpdate({
          target: chatMessages.id,
          set: {
            content: m.content,
            attachmentUrl: m.attachmentUrl,
          },
        });
    }
  });
}

export function useMessagesCache(roomId: string | undefined) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    // 1) 캐시 즉시 반영
    try {
      const cached = await loadFromCache(roomId);
      if (mounted.current && cached.length > 0) setMessages(cached);
    } catch { /* DB 미초기화 — initOfflineDb 가 끝나기 전 마운트 */ }

    // 2) 서버 호출
    try {
      const res = await api.get(`/messenger/rooms/${roomId}/messages?limit=50`);
      const list = (res.data?.data as ServerMessage[] | undefined ?? []).map(normalizeServer);
      // 시간 오름차순으로 정렬
      list.sort((a, b) => a.createdAt - b.createdAt);
      if (mounted.current) {
        setMessages(list);
        setIsOffline(false);
        setServerLoaded(true);
      }
      // 비동기 캐시 저장
      upsertToCache(list).catch(() => { /* 캐시 실패는 무시 */ });
    } catch {
      if (mounted.current) setIsOffline(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { refresh(); }, [refresh]);

  /** 새 메시지(socket 수신, 직접 전송 등)를 캐시 + state 모두에 추가 */
  const appendMessage = useCallback(async (msg: UiMessage) => {
    if (!mounted.current) return;
    setMessages((prev) => {
      // 중복 차단
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    upsertToCache([msg]).catch(() => { /* ignore */ });
  }, []);

  /** 메시지 삭제 — UI 즉시 + 캐시 마킹 */
  const removeMessage = useCallback(async (msgId: string) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: '(삭제된 메시지)', isDeleted: true } : m));
    try {
      await db.update(chatMessages)
        .set({ content: '(삭제된 메시지)' })
        .where(eq(chatMessages.id, msgId));
    } catch { /* ignore */ }
  }, []);

  /** 룸의 페이지네이션 — 더 오래된 메시지 추가 fetch + 앞쪽 prepend */
  const prependOlder = useCallback(async (older: UiMessage[]) => {
    if (older.length === 0) return;
    older.sort((a, b) => a.createdAt - b.createdAt);
    setMessages((prev) => [...older.filter((o) => !prev.some((m) => m.id === o.id)), ...prev]);
    upsertToCache(older).catch(() => { /* ignore */ });
  }, []);

  return { messages, loading, isOffline, serverLoaded, refresh, appendMessage, removeMessage, prependOlder };
}

/** 룸 외부에서 메시지 1건 캐시에 직접 추가 (예: 푸시 도착 시 listing 화면에서 미리 캐시) */
export async function cacheMessageDirect(msg: UiMessage): Promise<void> {
  upsertToCache([msg]).catch(() => { /* ignore */ });
}
