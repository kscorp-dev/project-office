import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🎬 데모 데이터 생성 시작...\n');

  // === 사용자 조회 ===
  const admin = await prisma.user.findUnique({ where: { employeeId: 'admin' } });
  const user01 = await prisma.user.findUnique({ where: { employeeId: 'user01' } });
  const user02 = await prisma.user.findUnique({ where: { employeeId: 'user02' } });
  const user03 = await prisma.user.findUnique({ where: { employeeId: 'user03' } });

  if (!admin || !user01 || !user02 || !user03) {
    console.error('기본 seed를 먼저 실행해주세요: npx tsx prisma/seed.ts');
    return;
  }

  const users = [admin, user01, user02, user03];
  const devDept = await prisma.department.findUnique({ where: { code: 'DEV' } });
  const designDept = await prisma.department.findUnique({ where: { code: 'DESIGN' } });
  const prodDept = await prisma.department.findUnique({ where: { code: 'PROD' } });
  const salesDept = await prisma.department.findUnique({ where: { code: 'SALES' } });
  const mgmtDept = await prisma.department.findUnique({ where: { code: 'MGMT' } });

  // ============================
  // 1. 전자결재 데모
  // ============================
  console.log('1/10 전자결재 데모 데이터...');
  const templates = await prisma.approvalTemplate.findMany();
  const draftTmpl = templates.find(t => t.code === 'DRAFT')!;
  const expenseTmpl = templates.find(t => t.code === 'EXPENSE')!;
  const vacTmpl = templates.find(t => t.code === 'VACATION')!;
  const purchaseTmpl = templates.find(t => t.code === 'PURCHASE')!;

  const approvalDocs = [
    { tmpl: draftTmpl, title: '2026년 2분기 사업 계획서', drafter: user01, status: 'approved' as const, urgency: 'normal' },
    { tmpl: expenseTmpl, title: '4월 출장비 정산 (서울→부산)', drafter: user01, status: 'pending' as const, urgency: 'normal' },
    { tmpl: vacTmpl, title: '연차 휴가 신청 (4/14~4/15)', drafter: user02, status: 'approved' as const, urgency: 'normal' },
    { tmpl: purchaseTmpl, title: 'Adobe Creative Suite 라이선스 구매', drafter: user02, status: 'pending' as const, urgency: 'urgent' },
    { tmpl: draftTmpl, title: '신규 프로젝트 착수 보고', drafter: user03, status: 'draft' as const, urgency: 'normal' },
    { tmpl: expenseTmpl, title: '생산 장비 유지보수비 청구', drafter: user03, status: 'rejected' as const, urgency: 'normal' },
  ];

  let docSeq = 1;
  for (const doc of approvalDocs) {
    const docNumber = `${doc.tmpl.code}-2026-${String(docSeq++).padStart(4, '0')}`;
    const existing = await prisma.approvalDocument.findUnique({ where: { docNumber } });
    if (existing) continue;

    await prisma.approvalDocument.create({
      data: {
        docNumber,
        templateId: doc.tmpl.id,
        title: doc.title,
        content: `<p>${doc.title}에 대한 상세 내용입니다.</p><p>검토 후 결재 부탁드립니다.</p>`,
        status: doc.status,
        drafterId: doc.drafter.id,
        urgency: doc.urgency,
        submittedAt: doc.status !== 'draft' ? new Date() : null,
        completedAt: ['approved', 'rejected'].includes(doc.status) ? new Date() : null,
        lines: {
          create: [
            { approverId: user03.id, step: 1, status: doc.status === 'approved' ? 'approved' : doc.status === 'rejected' ? 'rejected' : 'pending', actedAt: ['approved', 'rejected'].includes(doc.status) ? new Date() : null, comment: doc.status === 'rejected' ? '예산 초과로 반려합니다' : doc.status === 'approved' ? '승인합니다' : null },
            { approverId: admin.id, step: 2, status: doc.status === 'approved' ? 'approved' : 'pending', actedAt: doc.status === 'approved' ? new Date() : null },
          ],
        },
      },
    });
  }

  // ============================
  // 2. 메신저 데모
  // ============================
  console.log('2/10 메신저 데모 데이터...');
  const chatRooms = [
    { name: null, type: 'direct', members: [admin.id, user01.id] },
    { name: '프로젝트 A 팀', type: 'group', members: [admin.id, user01.id, user02.id, user03.id] },
    { name: '디자인팀 공지', type: 'group', members: [admin.id, user02.id] },
  ];

  for (const room of chatRooms) {
    const existingRoom = await prisma.chatRoom.findFirst({
      where: { name: room.name, type: room.type },
    });
    if (existingRoom) continue;

    const newRoom = await prisma.chatRoom.create({
      data: {
        name: room.name,
        type: room.type,
        creatorId: admin.id,
        participants: {
          create: room.members.map(userId => ({ userId })),
        },
      },
    });

    // 메시지 추가
    const messages = room.type === 'direct'
      ? [
          { senderId: admin.id, content: '김철수님, 이번 주 회의 자료 준비해주세요.' },
          { senderId: user01.id, content: '네, 목요일까지 준비하겠습니다.' },
          { senderId: admin.id, content: '감사합니다. PPT 형식으로 부탁드려요.' },
        ]
      : [
          { senderId: admin.id, content: '안녕하세요, 프로젝트 킥오프 미팅을 공지합니다.' },
          { senderId: user02.id, content: '참석 확인했습니다!' },
          { senderId: user01.id, content: '개발 일정은 어떻게 되나요?' },
          { senderId: user03.id, content: '생산팀도 참석합니다.' },
          { senderId: admin.id, content: '내일 오후 2시 회의실 B에서 진행합니다.' },
        ];

    for (const msg of messages) {
      await prisma.message.create({
        data: { roomId: newRoom.id, senderId: msg.senderId, content: msg.content },
      });
    }
  }

  // ============================
  // 3. CCTV 데모
  // ============================
  console.log('3/10 CCTV 데모 데이터...');
  const cctvGroups = [
    { name: '본사 1층', cameras: [
      { name: '정문 카메라', location: '본사 1층 정문', status: 'online' },
      { name: '로비 카메라', location: '본사 1층 로비', status: 'online' },
      { name: '주차장 입구', location: '본사 B1 주차장', status: 'online' },
    ]},
    { name: '생산동', cameras: [
      { name: '생산라인 A', location: '생산동 1층 A라인', status: 'online' },
      { name: '생산라인 B', location: '생산동 1층 B라인', status: 'offline' },
      { name: '자재 창고', location: '생산동 2층 창고', status: 'online' },
    ]},
    { name: '사무동', cameras: [
      { name: '3층 복도', location: '사무동 3층', status: 'online' },
      { name: '회의실 A', location: '사무동 2층 회의실A', status: 'online', isPtz: true },
    ]},
  ];

  for (const group of cctvGroups) {
    const existing = await prisma.cameraGroup.findFirst({ where: { name: group.name } });
    if (existing) continue;

    const newGroup = await prisma.cameraGroup.create({ data: { name: group.name } });
    for (const cam of group.cameras) {
      await prisma.camera.create({
        data: {
          name: cam.name,
          rtspUrl: `rtsp://192.168.1.${Math.floor(Math.random() * 200 + 10)}:554/stream1`,
          location: cam.location,
          groupId: newGroup.id,
          isPtz: (cam as any).isPtz || false,
        },
      });
    }
  }

  // ============================
  // 4. 근태 데모
  // ============================
  console.log('4/10 근태관리 데모 데이터...');
  // 최근 5일 출퇴근 기록 생성
  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const date = new Date();
    date.setDate(date.getDate() - dayOffset);
    date.setHours(0, 0, 0, 0);

    for (const u of [user01, user02, user03]) {
      const existing = await prisma.attendance.findFirst({
        where: { userId: u.id, checkTime: { gte: date, lt: new Date(date.getTime() + 86400000) } },
      });
      if (existing) continue;

      const checkInHour = 8 + Math.floor(Math.random() * 2);
      const checkInMin = Math.floor(Math.random() * 30);
      const checkOutHour = 17 + Math.floor(Math.random() * 3);
      const checkOutMin = Math.floor(Math.random() * 60);

      const checkIn = new Date(date);
      checkIn.setHours(checkInHour, checkInMin);
      const checkOut = new Date(date);
      checkOut.setHours(checkOutHour, checkOutMin);

      if (dayOffset === 0 && new Date().getHours() < 9) continue; // 오늘 아직 출근 전이면 스킵

      await prisma.attendance.create({
        data: { userId: u.id, type: 'check_in', checkTime: checkIn, deviceType: 'web' },
      });
      if (dayOffset > 0) { // 과거 날짜면 퇴근도
        await prisma.attendance.create({
          data: { userId: u.id, type: 'check_out', checkTime: checkOut, deviceType: 'web' },
        });
      }
    }
  }

  // 휴가 데이터
  const vacations = [
    { userId: user01.id, type: 'annual' as const, startDate: '2026-04-20', endDate: '2026-04-21', days: 2, reason: '개인 사유', status: 'approved' as const },
    { userId: user02.id, type: 'half_am' as const, startDate: '2026-04-10', endDate: '2026-04-10', days: 0.5, reason: '병원 방문', status: 'approved' as const },
    { userId: user03.id, type: 'annual' as const, startDate: '2026-05-01', endDate: '2026-05-05', days: 3, reason: '가족 여행', status: 'pending' as const },
  ];

  for (const v of vacations) {
    const existing = await prisma.vacation.findFirst({
      where: { userId: v.userId, startDate: new Date(v.startDate) },
    });
    if (existing) continue;

    await prisma.vacation.create({
      data: {
        userId: v.userId,
        type: v.type,
        startDate: new Date(v.startDate),
        endDate: new Date(v.endDate),
        days: v.days,
        reason: v.reason,
        status: v.status,
        approvedBy: v.status === 'approved' ? admin.id : null,
        approvedAt: v.status === 'approved' ? new Date() : null,
      },
    });
  }

  // 연차 잔여
  for (const u of [user01, user02, user03]) {
    await prisma.vacationBalance.upsert({
      where: { userId_year: { userId: u.id, year: 2026 } },
      update: {},
      create: { userId: u.id, year: 2026, totalDays: 15, usedDays: u === user01 ? 3 : u === user02 ? 1.5 : 0, remainDays: u === user01 ? 12 : u === user02 ? 13.5 : 15 },
    });
  }

  // ============================
  // 5. 캘린더 데모
  // ============================
  console.log('5/10 캘린더 데모 데이터...');
  const now = new Date();
  const events = [
    { title: '주간 정기 회의', scope: 'company', color: '#3B82F6', startOffset: 1, allDay: false, startHour: 10, endHour: 11, creator: admin },
    { title: '프로젝트 A 중간 점검', scope: 'department', color: '#EF4444', startOffset: 3, allDay: false, startHour: 14, endHour: 16, creator: user01 },
    { title: '디자인 리뷰', scope: 'department', color: '#8B5CF6', startOffset: 2, allDay: false, startHour: 15, endHour: 16, creator: user02 },
    { title: '공장 점검일', scope: 'company', color: '#10B981', startOffset: 5, allDay: true, startHour: 0, endHour: 0, creator: user03 },
    { title: '신입사원 OT', scope: 'company', color: '#F59E0B', startOffset: 7, allDay: false, startHour: 9, endHour: 12, creator: admin },
    { title: '거래처 미팅 (삼성물산)', scope: 'personal', color: '#EC4899', startOffset: 4, allDay: false, startHour: 13, endHour: 14, creator: user03 },
    { title: '보안 교육', scope: 'company', color: '#06B6D4', startOffset: 10, allDay: false, startHour: 14, endHour: 17, creator: admin },
    { title: '분기 실적 발표', scope: 'company', color: '#EF4444', startOffset: 14, allDay: false, startHour: 10, endHour: 12, creator: admin },
  ];

  for (const ev of events) {
    const existing = await prisma.calendarEvent.findFirst({ where: { title: ev.title } });
    if (existing) continue;

    const start = new Date(now);
    start.setDate(start.getDate() + ev.startOffset);
    start.setHours(ev.startHour, 0, 0, 0);
    const end = new Date(start);
    if (ev.allDay) {
      end.setHours(23, 59, 59, 0);
    } else {
      end.setHours(ev.endHour, 0, 0, 0);
    }

    await prisma.calendarEvent.create({
      data: {
        title: ev.title,
        startDate: start,
        endDate: end,
        allDay: ev.allDay,
        color: ev.color,
        scope: ev.scope,
        creatorId: ev.creator.id,
        departmentId: ev.scope === 'department' ? ev.creator.departmentId : null,
      },
    });
  }

  // ============================
  // 6. 게시판 데모
  // ============================
  console.log('6/10 게시판 데모 데이터...');
  const boards = await prisma.board.findMany();
  const noticeBoard = boards.find(b => b.type === 'notice') || boards[0];
  const freeBoard = boards.find(b => b.name === '자유게시판') || boards[1];

  if (noticeBoard && freeBoard) {
    const posts = [
      { board: noticeBoard, title: '[공지] 2026년 하계 휴가 일정 안내', content: '<p>안녕하세요, 경영지원팀입니다.</p><p>2026년 하계 휴가 기간은 7월 28일(월) ~ 8월 1일(금)까지 5일간입니다.</p><p>개인 연차를 활용하여 전후 일정을 조율하시기 바랍니다.</p><ul><li>휴가 신청: 6월 30일까지</li><li>비상 연락망: 경영지원팀 내선 100</li></ul>', author: admin, isPinned: true, isMustRead: true },
      { board: noticeBoard, title: '[공지] 사내 보안 정책 업데이트', content: '<p>정보보안팀에서 안내드립니다.</p><p>USB 사용 정책이 변경되어 사전 승인 없이 USB 장치를 사용할 수 없습니다.</p><p>자세한 내용은 인트라넷을 참고하세요.</p>', author: admin, isPinned: true, isMustRead: false },
      { board: noticeBoard, title: '[안내] 4월 사내 교육 일정', content: '<p>4월 교육 일정 안내합니다.</p><ol><li>신입사원 교육: 4/15(화) 09:00~12:00</li><li>보안 교육: 4/18(금) 14:00~17:00</li><li>리더십 교육: 4/22(화) 10:00~12:00</li></ol>', author: admin, isPinned: false, isMustRead: false },
      { board: freeBoard, title: '점심 맛집 추천 (본사 주변)', content: '<p>본사 주변 맛집 공유합니다!</p><ul><li>이탈리안: 파스타바 (도보 5분)</li><li>한식: 한솥밥 (도보 3분)</li><li>일식: 스시히로 (도보 7분)</li></ul><p>추천 있으시면 댓글 달아주세요~</p>', author: user01, isPinned: false, isMustRead: false },
      { board: freeBoard, title: '사내 동호회 모집 - 축구부', content: '<p>사내 축구 동호회를 모집합니다.</p><p>매주 토요일 오전 7시~9시 활동합니다.</p><p>관심 있으신 분은 내선 205로 연락주세요.</p>', author: user03, isPinned: false, isMustRead: false },
      { board: freeBoard, title: '분실물 안내 - 검정색 우산', content: '<p>3층 휴게실에 검정색 접이식 우산이 있습니다.</p><p>주인 찾습니다. 경영지원팀으로 연락 바랍니다.</p>', author: user02, isPinned: false, isMustRead: false },
    ];

    for (const p of posts) {
      const existing = await prisma.post.findFirst({ where: { title: p.title } });
      if (existing) continue;

      const post = await prisma.post.create({
        data: {
          boardId: p.board.id,
          authorId: p.author.id,
          title: p.title,
          content: p.content,
          isPinned: p.isPinned,
          isMustRead: p.isMustRead,
          viewCount: Math.floor(Math.random() * 50) + 5,
        },
      });

      // 댓글 추가
      if (p.title.includes('맛집')) {
        await prisma.comment.create({ data: { postId: post.id, authorId: user02.id, content: '파스타바 진짜 맛있어요! 크림파스타 추천합니다.' } });
        await prisma.comment.create({ data: { postId: post.id, authorId: user03.id, content: '한솥밥 제육볶음이 최고입니다 ㅋㅋ' } });
      }
      if (p.title.includes('축구')) {
        await prisma.comment.create({ data: { postId: post.id, authorId: user01.id, content: '저도 참여하겠습니다! 포지션은 미드필더 가능합니다.' } });
      }
    }
  }

  // ============================
  // 7. 작업지시서 데모
  // ============================
  console.log('7/10 작업지시서 데모 데이터...');
  // 거래처 먼저
  const clients = [
    { companyName: '삼성물산', businessNumber: '123-45-67890', contactPerson: '김대리', phone: '02-1234-5678', email: 'kim@samsung.com' },
    { companyName: '현대건설', businessNumber: '234-56-78901', contactPerson: '이과장', phone: '02-2345-6789', email: 'lee@hyundai.com' },
    { companyName: '(주)에이스디자인', businessNumber: '345-67-89012', contactPerson: '박실장', phone: '031-456-7890', email: 'park@ace.com' },
  ];

  for (const c of clients) {
    await prisma.client.upsert({
      where: { id: c.companyName },
      update: {},
      create: c,
    });
  }

  const allClients = await prisma.client.findMany();

  const taskOrders = [
    { title: '삼성물산 본사 사이니지 제작', status: 'in_progress', priority: 'high', client: allClients[0], category: '사이니지', daysAgo: 5, dueDays: 10 },
    { title: '현대건설 모델하우스 래핑', status: 'work_complete', priority: 'normal', client: allClients[1], category: '래핑', daysAgo: 15, dueDays: -2 },
    { title: '에이스디자인 카탈로그 출력', status: 'instructed', priority: 'urgent', client: allClients[2], category: '출력', daysAgo: 1, dueDays: 3 },
    { title: '본사 엘리베이터 안내판 교체', status: 'draft', priority: 'low', client: null, category: '시설', daysAgo: 0, dueDays: 14 },
    { title: '영업팀 명함 500매 제작', status: 'final_complete', priority: 'normal', client: null, category: '인쇄', daysAgo: 20, dueDays: -10 },
    { title: '생산동 안전 표지판 설치', status: 'partial_complete', priority: 'high', client: null, category: '시설', daysAgo: 7, dueDays: 5 },
  ];

  for (let i = 0; i < taskOrders.length; i++) {
    const t = taskOrders[i];
    const taskNumber = `T20260408${String(i + 1).padStart(5, '0')}`;
    const existing = await prisma.taskOrder.findUnique({ where: { taskNumber } });
    if (existing) continue;

    const instructionDate = new Date();
    instructionDate.setDate(instructionDate.getDate() - t.daysAgo);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + t.dueDays);

    const task = await prisma.taskOrder.create({
      data: {
        taskNumber,
        title: t.title,
        description: `${t.title}에 대한 상세 작업 내용입니다.\n\n작업 시 주의사항:\n1. 품질 기준 준수\n2. 납기 일정 엄수\n3. 안전 수칙 이행`,
        creatorId: admin.id,
        priority: t.priority as any,
        status: t.status as any,
        category: t.category,
        instructionDate,
        dueDate,
        clientId: t.client?.id,
        completedAt: t.status === 'final_complete' ? new Date() : null,
        assignees: {
          create: [
            { userId: user03.id, role: 'main' },
            { userId: user02.id, role: 'designer' },
          ],
        },
        items: {
          create: [
            { itemName: `${t.category} 작업 - 메인`, quantity: 1, unit: '건', unitPrice: 500000, totalPrice: 500000, sortOrder: 0 },
            { itemName: '부자재/소모품', quantity: 5, unit: 'EA', unitPrice: 10000, totalPrice: 50000, sortOrder: 1 },
          ],
        },
        checklist: {
          create: [
            { content: '디자인 시안 확인', isCompleted: ['in_progress', 'partial_complete', 'work_complete', 'final_complete'].includes(t.status), sortOrder: 0 },
            { content: '자재 준비 완료', isCompleted: ['partial_complete', 'work_complete', 'final_complete'].includes(t.status), sortOrder: 1 },
            { content: '생산/제작 완료', isCompleted: ['work_complete', 'final_complete'].includes(t.status), sortOrder: 2 },
            { content: '품질 검수 통과', isCompleted: t.status === 'final_complete', sortOrder: 3 },
            { content: '납품/설치 완료', isCompleted: t.status === 'final_complete', sortOrder: 4 },
          ],
        },
      },
    });

    // 상태 이력
    await prisma.taskStatusHistory.create({
      data: { taskId: task.id, fromStatus: null, toStatus: 'draft', changedBy: admin.id, comment: '작업지시서 작성' },
    });
    if (t.status !== 'draft') {
      await prisma.taskStatusHistory.create({
        data: { taskId: task.id, fromStatus: 'draft', toStatus: 'instructed', changedBy: admin.id, comment: '작업 지시' },
      });
    }
    if (['in_progress', 'partial_complete', 'work_complete', 'final_complete'].includes(t.status)) {
      await prisma.taskStatusHistory.create({
        data: { taskId: task.id, fromStatus: 'instructed', toStatus: 'in_progress', changedBy: user03.id, comment: '작업 시작합니다' },
      });
    }

    // 코멘트
    if (t.status !== 'draft') {
      await prisma.taskComment.create({
        data: { taskId: task.id, userId: user03.id, content: '자재 확인 완료했습니다. 일정대로 진행하겠습니다.' },
      });
      await prisma.taskComment.create({
        data: { taskId: task.id, userId: user02.id, content: '디자인 시안 첨부합니다. 확인 부탁드립니다.' },
      });
    }

    // 대금청구
    if (t.client) {
      await prisma.taskBilling.create({
        data: {
          taskId: task.id,
          billingRequired: true,
          billingType: 'tax_invoice',
          amount: 550000,
          vatIncluded: false,
          billingStatus: t.status === 'final_complete' ? 'paid' : 'pending',
        },
      });
    }
  }

  // ============================
  // 8. 자재관리 데모
  // ============================
  console.log('8/10 자재관리 데모 데이터...');
  const invCategories = [
    { name: '출력 용지', items: [
      { code: 'MAT-001', name: '광택 포토용지 A3', unit: 'ROLL', spec: '1270mm x 30m', stock: 15, min: 5, price: 85000, loc: 'A-1-01' },
      { code: 'MAT-002', name: '무광 비닐 시트', unit: 'ROLL', spec: '1520mm x 50m', stock: 8, min: 3, price: 120000, loc: 'A-1-02' },
      { code: 'MAT-003', name: '캔버스 원단', unit: 'ROLL', spec: '1100mm x 18m', stock: 3, min: 5, price: 65000, loc: 'A-1-03' },
    ]},
    { name: '잉크', items: [
      { code: 'INK-001', name: 'UV 잉크 (시안)', unit: 'EA', spec: '1L', stock: 12, min: 4, price: 180000, loc: 'B-1-01' },
      { code: 'INK-002', name: 'UV 잉크 (마젠타)', unit: 'EA', spec: '1L', stock: 10, min: 4, price: 180000, loc: 'B-1-02' },
      { code: 'INK-003', name: 'UV 잉크 (옐로)', unit: 'EA', spec: '1L', stock: 2, min: 4, price: 180000, loc: 'B-1-03' },
      { code: 'INK-004', name: 'UV 잉크 (블랙)', unit: 'EA', spec: '1L', stock: 8, min: 4, price: 180000, loc: 'B-1-04' },
    ]},
    { name: '부자재', items: [
      { code: 'ACC-001', name: '라미네이팅 필름 (유광)', unit: 'ROLL', spec: '1270mm x 50m', stock: 20, min: 5, price: 45000, loc: 'C-1-01' },
      { code: 'ACC-002', name: '양면테이프', unit: 'BOX', spec: '25mm x 50m (10EA)', stock: 30, min: 10, price: 25000, loc: 'C-2-01' },
      { code: 'ACC-003', name: '아크릴판 (투명)', unit: 'EA', spec: '600x900mm 3T', stock: 1, min: 10, price: 12000, loc: 'C-3-01' },
    ]},
  ];

  for (const cat of invCategories) {
    let category = await prisma.inventoryCategory.findFirst({ where: { name: cat.name } });
    if (!category) {
      category = await prisma.inventoryCategory.create({ data: { name: cat.name } });
    }

    for (const item of cat.items) {
      const existing = await prisma.inventoryItem.findUnique({ where: { code: item.code } });
      if (existing) continue;

      const invItem = await prisma.inventoryItem.create({
        data: {
          code: item.code,
          name: item.name,
          categoryId: category.id,
          unit: item.unit,
          specification: item.spec,
          minStock: item.min,
          currentStock: item.stock,
          unitPrice: item.price,
          location: item.loc,
        },
      });

      // 최근 입출고 이력
      const txTypes = ['in_stock', 'out_stock', 'in_stock'] as const;
      for (let j = 0; j < 3; j++) {
        const txDate = new Date();
        txDate.setDate(txDate.getDate() - (j * 3 + 1));
        const qty = Math.floor(Math.random() * 5) + 1;
        await prisma.inventoryTransaction.create({
          data: {
            itemId: invItem.id,
            type: txTypes[j],
            quantity: qty,
            unitPrice: item.price,
            totalPrice: item.price * qty,
            beforeStock: item.stock + (txTypes[j] === 'out_stock' ? qty : -qty),
            afterStock: item.stock,
            reason: txTypes[j] === 'in_stock' ? '정기 입고' : '작업 출고',
            processedBy: user03.id,
            processedAt: txDate,
          },
        });
      }
    }
  }

  // ============================
  // 9. 화상회의 데모
  // ============================
  console.log('9/10 화상회의 데모 데이터...');
  const meetings = [
    { title: '주간 전체 회의', status: 'scheduled', scheduledOffset: 1, hour: 10, host: admin, participants: [user01, user02, user03] },
    { title: '디자인 검토 회의', status: 'scheduled', scheduledOffset: 2, hour: 14, host: user02, participants: [admin, user01] },
    { title: '프로젝트 A 킥오프', status: 'ended', scheduledOffset: -2, hour: 15, host: admin, participants: [user01, user02, user03] },
    { title: '생산 일정 조율', status: 'scheduled', scheduledOffset: 3, hour: 11, host: user03, participants: [admin, user01] },
  ];

  for (const m of meetings) {
    const existing = await prisma.meeting.findFirst({ where: { title: m.title } });
    if (existing) continue;

    const scheduled = new Date();
    scheduled.setDate(scheduled.getDate() + m.scheduledOffset);
    scheduled.setHours(m.hour, 0, 0, 0);

    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await prisma.meeting.create({
      data: {
        title: m.title,
        description: `${m.title} - 참석 필수`,
        hostId: m.host.id,
        status: m.status as any,
        roomCode,
        scheduledAt: scheduled,
        startedAt: m.status === 'ended' ? scheduled : null,
        endedAt: m.status === 'ended' ? new Date(scheduled.getTime() + 3600000) : null,
        participants: {
          create: [
            { userId: m.host.id, role: 'host', isInvited: true },
            ...m.participants.map(p => ({ userId: p.id, role: 'participant', isInvited: true })),
          ],
        },
      },
    });
  }

  // ============================
  // 10. 문서관리 데모
  // ============================
  console.log('10/10 문서관리 데모 데이터...');
  const folders = [
    { name: '프로젝트 문서', owner: admin, shared: true, files: [
      { name: '프로젝트A_기획서_v2.pdf', size: 2500000, mime: 'application/pdf' },
      { name: '프로젝트A_일정표.xlsx', size: 150000, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { name: '프로젝트A_회의록_0401.docx', size: 85000, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ]},
    { name: '디자인 자료', owner: user02, shared: true, files: [
      { name: '브랜드_가이드라인.pdf', size: 15000000, mime: 'application/pdf' },
      { name: '로고_최종.ai', size: 8500000, mime: 'application/illustrator' },
      { name: '컬러_팔레트.png', size: 250000, mime: 'image/png' },
    ]},
    { name: '경영 자료', owner: admin, shared: false, files: [
      { name: '2026_사업계획서.pptx', size: 5200000, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      { name: '1Q_실적보고.xlsx', size: 320000, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ]},
    { name: '생산 매뉴얼', owner: user03, shared: true, files: [
      { name: '장비_운영_매뉴얼.pdf', size: 4800000, mime: 'application/pdf' },
      { name: '안전_수칙.pdf', size: 1200000, mime: 'application/pdf' },
      { name: '품질_체크리스트.xlsx', size: 95000, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ]},
  ];

  for (const f of folders) {
    let folder = await prisma.documentFolder.findFirst({ where: { name: f.name, ownerId: f.owner.id } });
    if (!folder) {
      folder = await prisma.documentFolder.create({
        data: { name: f.name, ownerId: f.owner.id, isShared: f.shared },
      });
    }

    for (const file of f.files) {
      const existing = await prisma.document.findFirst({ where: { fileName: file.name, folderId: folder.id } });
      if (existing) continue;

      await prisma.document.create({
        data: {
          folderId: folder.id,
          uploaderId: f.owner.id,
          fileName: file.name,
          filePath: `/uploads/documents/${file.name}`,
          fileSize: BigInt(file.size),
          mimeType: file.mime,
          isShared: f.shared,
          downloadCount: Math.floor(Math.random() * 20),
          tags: file.name.endsWith('.pdf') ? ['PDF', '문서'] : file.name.endsWith('.xlsx') ? ['엑셀', '데이터'] : ['기타'],
        },
      });
    }
  }

  // ============================
  // 시스템 설정
  // ============================
  const settings = [
    { key: 'company_name', value: 'KS Corporation', category: 'general', description: '회사명' },
    { key: 'max_login_attempts', value: '5', category: 'security', description: '최대 로그인 시도 횟수' },
    { key: 'password_min_length', value: '8', category: 'security', description: '비밀번호 최소 길이' },
    { key: 'session_timeout', value: '30', category: 'security', description: '세션 타임아웃 (분)' },
    { key: 'notification_email', value: 'admin@kscorp.com', category: 'notification', description: '알림 발송 이메일' },
    { key: 'maintenance_mode', value: 'false', category: 'system', description: '유지보수 모드' },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log('\n✅ 데모 데이터 생성 완료!');
  console.log('');
  console.log('📊 생성된 데이터:');
  console.log('  - 전자결재: 6건 (승인/대기/반려/임시저장)');
  console.log('  - 메신저: 채팅방 3개 + 메시지');
  console.log('  - CCTV: 3그룹 8대 카메라');
  console.log('  - 근태: 5일간 출퇴근 + 휴가 3건');
  console.log('  - 캘린더: 8개 일정');
  console.log('  - 게시판: 게시글 6개 + 댓글');
  console.log('  - 작업지시서: 6건 (다양한 상태)');
  console.log('  - 자재: 3카테고리 10종 + 입출고 이력');
  console.log('  - 화상회의: 4건');
  console.log('  - 문서: 4폴더 12파일');
  console.log('  - 시스템설정: 6항목');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
