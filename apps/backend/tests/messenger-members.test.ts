/**
 * 메신저 그룹 룸 멤버 관리 API 테스트
 *
 * - GET /messenger/rooms/:id — 멤버 정보 + 권한 검증
 * - POST /messenger/rooms/:id/members — 추가 (활성 사용자만, 1:1 거부)
 * - DELETE /messenger/rooms/:id/members/:userId — 본인 leave + 방장이 타인 제거
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import messengerRoutes from '../src/routes/messenger.routes';
import { config } from '../src/config';
import { createTestUser } from './fixtures';

const app = express();
app.use(express.json());
app.use('/messenger', messengerRoutes);

function tokenFor(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: '1h' });
}

let creator: Awaited<ReturnType<typeof createTestUser>>;
let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;
let outsider: Awaited<ReturnType<typeof createTestUser>>;
let inactiveUser: Awaited<ReturnType<typeof createTestUser>>;
let groupRoomId: string;
let directRoomId: string;

beforeAll(async () => {
  creator = await createTestUser({ role: 'user' as any });
  alice = await createTestUser({ role: 'user' as any });
  bob = await createTestUser({ role: 'user' as any });
  outsider = await createTestUser({ role: 'user' as any });
  inactiveUser = await createTestUser({ role: 'user' as any });
  await prisma.user.update({ where: { id: inactiveUser.id }, data: { status: 'inactive' } });
});

beforeEach(async () => {
  // 매번 새 그룹/직접 룸 만들고 정리
  if (groupRoomId) {
    await prisma.message.deleteMany({ where: { roomId: groupRoomId } });
    await prisma.chatParticipant.deleteMany({ where: { roomId: groupRoomId } });
    await prisma.chatRoom.delete({ where: { id: groupRoomId } }).catch(() => {});
  }
  if (directRoomId) {
    await prisma.message.deleteMany({ where: { roomId: directRoomId } });
    await prisma.chatParticipant.deleteMany({ where: { roomId: directRoomId } });
    await prisma.chatRoom.delete({ where: { id: directRoomId } }).catch(() => {});
  }
  const group = await prisma.chatRoom.create({
    data: {
      type: 'group',
      name: '그룹 테스트',
      creatorId: creator.id,
      participants: {
        create: [{ userId: creator.id }, { userId: alice.id }],
      },
    },
  });
  groupRoomId = group.id;

  const direct = await prisma.chatRoom.create({
    data: {
      type: 'direct',
      creatorId: creator.id,
      participants: { create: [{ userId: creator.id }, { userId: alice.id }] },
    },
  });
  directRoomId = direct.id;
});

afterAll(async () => {
  if (groupRoomId) {
    await prisma.message.deleteMany({ where: { roomId: groupRoomId } });
    await prisma.chatParticipant.deleteMany({ where: { roomId: groupRoomId } });
    await prisma.chatRoom.delete({ where: { id: groupRoomId } }).catch(() => {});
  }
  if (directRoomId) {
    await prisma.message.deleteMany({ where: { roomId: directRoomId } });
    await prisma.chatParticipant.deleteMany({ where: { roomId: directRoomId } });
    await prisma.chatRoom.delete({ where: { id: directRoomId } }).catch(() => {});
  }
  await prisma.user.deleteMany({
    where: { id: { in: [creator.id, alice.id, bob.id, outsider.id, inactiveUser.id] } },
  });
  await prisma.$disconnect();
});

describe('GET /messenger/rooms/:id', () => {
  it('참가자 → 200 + 활성 멤버 목록', async () => {
    const res = await request(app)
      .get(`/messenger/rooms/${groupRoomId}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(groupRoomId);
    expect(res.body.data.members).toHaveLength(2);
    const memberIds = res.body.data.members.map((m: any) => m.userId).sort();
    expect(memberIds).toEqual([creator.id, alice.id].sort());
  });

  it('비참가자 → 403', async () => {
    const res = await request(app)
      .get(`/messenger/rooms/${groupRoomId}`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /messenger/rooms/:id/members', () => {
  it('참가자가 새 멤버 추가 → 200 + 시스템 메시지 생성', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [bob.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(1);

    // 멤버 카운트 3
    const room = await prisma.chatRoom.findUnique({
      where: { id: groupRoomId },
      include: { participants: { where: { leftAt: null } } },
    });
    expect(room?.participants).toHaveLength(3);

    // 시스템 메시지 1건
    const sysMsg = await prisma.message.findFirst({
      where: { roomId: groupRoomId, type: 'system' },
    });
    expect(sysMsg?.content).toContain('초대');
  });

  it('이미 멤버인 사용자는 alreadyMember 카운트로', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [alice.id, bob.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(1);
    expect(res.body.data.alreadyMember).toBe(1);
  });

  it('비활성 사용자 추가 → 400 INVALID_USERS', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [inactiveUser.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_USERS');
  });

  it('1:1 채팅에 멤버 추가 → 400 NOT_GROUP', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${directRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [bob.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_GROUP');
  });

  it('비참가자가 추가 시도 → 403', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ userIds: [bob.id] });
    expect(res.status).toBe(403);
  });

  it('일반 멤버(방장 아님) 가 추가 시도 → 403 (방장만 초대 가능, H5)', async () => {
    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`) // alice 는 멤버지만 방장 아님
      .send({ userIds: [bob.id] });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('방장만');
  });

  it('새 멤버 추가 시 알림 자동 발사 (H3)', async () => {
    // 추가 전 bob 의 알림 0개
    await prisma.notification.deleteMany({ where: { recipientId: bob.id } });

    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [bob.id] });
    expect(res.status).toBe(200);

    const notifs = await prisma.notification.findMany({ where: { recipientId: bob.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('message_received');
    expect(notifs[0].refId).toBe(groupRoomId);
    expect(notifs[0].body).toContain('초대했습니다');

    await prisma.notification.deleteMany({ where: { recipientId: bob.id } });
  });

  it('떠난 사용자 재추가 → leftAt=null 로 복원', async () => {
    // alice 가 떠남
    await prisma.chatParticipant.updateMany({
      where: { roomId: groupRoomId, userId: alice.id },
      data: { leftAt: new Date() },
    });

    const res = await request(app)
      .post(`/messenger/rooms/${groupRoomId}/members`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`)
      .send({ userIds: [alice.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(1);

    const reloaded = await prisma.chatParticipant.findFirst({
      where: { roomId: groupRoomId, userId: alice.id },
    });
    expect(reloaded?.leftAt).toBeNull();
  });
});

describe('DELETE /messenger/rooms/:id/members/:userId', () => {
  it('본인이 leave (자기 자신 제거) → 200', async () => {
    const res = await request(app)
      .delete(`/messenger/rooms/${groupRoomId}/members/${alice.id}`)
      .set('Authorization', `Bearer ${tokenFor(alice)}`);
    expect(res.status).toBe(200);
    const reloaded = await prisma.chatParticipant.findFirst({
      where: { roomId: groupRoomId, userId: alice.id },
    });
    expect(reloaded?.leftAt).toBeTruthy();
  });

  it('방장이 타인 제거 → 200', async () => {
    const res = await request(app)
      .delete(`/messenger/rooms/${groupRoomId}/members/${alice.id}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(200);
  });

  it('일반 멤버가 타인 제거 → 403', async () => {
    // bob 추가
    await prisma.chatParticipant.create({ data: { roomId: groupRoomId, userId: bob.id } });

    const res = await request(app)
      .delete(`/messenger/rooms/${groupRoomId}/members/${alice.id}`)
      .set('Authorization', `Bearer ${tokenFor(bob)}`); // bob 은 멤버지만 방장 아님
    expect(res.status).toBe(403);
  });

  it('1:1 채팅 멤버 제거 → 400 NOT_GROUP', async () => {
    const res = await request(app)
      .delete(`/messenger/rooms/${directRoomId}/members/${alice.id}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_GROUP');
  });

  it('이미 떠난 사용자 다시 제거 → 404 MEMBER_NOT_FOUND', async () => {
    await prisma.chatParticipant.updateMany({
      where: { roomId: groupRoomId, userId: alice.id },
      data: { leftAt: new Date() },
    });
    const res = await request(app)
      .delete(`/messenger/rooms/${groupRoomId}/members/${alice.id}`)
      .set('Authorization', `Bearer ${tokenFor(creator)}`);
    expect(res.status).toBe(404);
  });
});
