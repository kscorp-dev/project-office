/**
 * 메신저 방 목록 훅 — 오프라인 캐시 우선, 네트워크 성공 시 갱신.
 *
 * UX:
 *   1) 마운트 즉시 SQLite 캐시에서 읽어 렌더 (즉시 "최근 목록" 표시)
 *   2) 동시에 GET /messenger/rooms 호출
 *   3) 응답 도착 시 DB 에 upsert + state 갱신 + 로컬에 없던 방 제거
 *   4) 네트워크 실패 시 캐시 데이터 유지 + isOffline=true
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { desc, inArray, eq } from 'drizzle-orm';
import api from '../services/api';
import { db } from '../offline-db';
import { chatRooms, syncMeta } from '../offline-db/schema';

export interface UiChatRoom {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  participants: Array<{ id: string; name: string }>;
}

interface ServerRoom {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  updatedAt: string;
  unreadCount: number;
  lastMessage?: {
    content: string | null;
    type: string;
    createdAt: string;
  } | null;
  participants: Array<{ userId: string; user: { id: string; name: string } }>;
}

function normalizeServer(r: ServerRoom): UiChatRoom {
  const preview = !r.lastMessage
    ? null
    : r.lastMessage.type === 'image' ? '📷 사진'
    : r.lastMessage.type === 'file' ? '📎 파일'
    : r.lastMessage.content;
  return {
    id: r.id,
    type: r.type,
    name: r.name ?? null,
    lastMessageAt: r.lastMessage ? new Date(r.lastMessage.createdAt).getTime() : new Date(r.updatedAt).getTime(),
    lastMessagePreview: preview ?? null,
    unreadCount: r.unreadCount ?? 0,
    participants: r.participants.map((p) => ({ id: p.user.id, name: p.user.name })),
  };
}

async function loadFromCache(): Promise<UiChatRoom[]> {
  const rows = await db.select().from(chatRooms).orderBy(desc(chatRooms.lastMessageAt));
  return rows.map((r) => ({
    id: r.id,
    type: (r.type as 'direct' | 'group') ?? 'direct',
    name: r.name ?? null,
    lastMessageAt: r.lastMessageAt ?? null,
    lastMessagePreview: r.lastMessagePreview ?? null,
    unreadCount: r.unreadCount ?? 0,
    participants: r.participantsJson ? safeParse(r.participantsJson) : [],
  }));
}

function safeParse(s: string): Array<{ id: string; name: string }> {
  try { return JSON.parse(s); } catch { return []; }
}

async function saveToCache(list: UiChatRoom[]) {
  const now = Date.now();
  // drizzle expo-sqlite 의 transaction 은 sync API — async 콜백을 쓰면 BEGIN/COMMIT 가 콜백 완료 전에
  // 닫혀버려서 inner inserts 가 트랜잭션 밖에서 실행됨. 단건 upsert 로 처리 (auto-commit).
  for (const r of list) {
    const data = {
      id: r.id,
      type: r.type,
      name: r.name,
      lastMessageAt: r.lastMessageAt,
      lastMessagePreview: r.lastMessagePreview,
      unreadCount: r.unreadCount,
      participantsJson: JSON.stringify(r.participants),
      syncedAt: now,
    };
    try {
      await db.insert(chatRooms).values(data).onConflictDoUpdate({
        target: chatRooms.id,
        set: data,
      });
    } catch { /* 단건 실패는 무시 */ }
  }
  // 서버에 없는 로컬 방 제거
  try {
    const ids = list.map((r) => r.id);
    const existing = await db.select({ id: chatRooms.id }).from(chatRooms);
    const orphan = existing.map((e) => e.id).filter((id) => !ids.includes(id));
    if (orphan.length > 0) {
      await db.delete(chatRooms).where(inArray(chatRooms.id, orphan));
    }
  } catch { /* ignore */ }
  // sync meta
  try {
    await db.insert(syncMeta).values({
      key: 'rooms',
      lastSyncedAt: now,
      errorCount: 0,
    }).onConflictDoUpdate({
      target: syncMeta.key,
      set: { lastSyncedAt: now, errorCount: 0 },
    });
  } catch { /* ignore */ }
}

export function useChatRooms() {
  const [rooms, setRooms] = useState<UiChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    // 1) 캐시 즉시 반영 (UI 깜빡임 방지)
    try {
      const cached = await loadFromCache();
      if (mounted.current) setRooms(cached);
    } catch { /* 최초 마운트 시 테이블 미존재 가능성 — initOfflineDb 완료 전 */ }

    // 2) 서버 요청
    try {
      const res = await api.get('/messenger/rooms');
      const normalized = (res.data?.data as ServerRoom[] | undefined ?? []).map(normalizeServer);
      if (mounted.current) {
        setRooms(normalized);
        setIsOffline(false);
        setLastSyncedAt(Date.now());
      }
      // 3) 비동기로 캐시 저장 (UI 막지 않음)
      saveToCache(normalized).catch(() => { /* 캐시 실패는 무시 */ });
    } catch {
      if (mounted.current) setIsOffline(true);
      // 기존 rooms 유지
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** 방 unreadCount 를 로컬에서 즉시 0으로 (방 진입 시 호출) */
  const markRoomRead = useCallback(async (roomId: string) => {
    setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, unreadCount: 0 } : r));
    try {
      await db.update(chatRooms).set({ unreadCount: 0 }).where(eq(chatRooms.id, roomId));
    } catch { /* ignore */ }
  }, []);

  return { rooms, loading, isOffline, lastSyncedAt, refresh, markRoomRead };
}
