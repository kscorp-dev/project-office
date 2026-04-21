import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { messengerFileFilter, meetingFileFilter } from './fileFilter';

/** 테스트용 Multer file 객체 생성 헬퍼 */
function makeFile(originalname: string, mimetype: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: 1024,
    stream: undefined as any,
    destination: '',
    filename: originalname,
    path: '',
    buffer: Buffer.from(''),
  };
}

/** cb를 Promise로 감싸 쉽게 assert */
function runFilter(
  filter: typeof messengerFileFilter,
  filename: string,
  mime: string,
): Promise<{ accepted: boolean; error?: Error }> {
  return new Promise((resolve) => {
    filter({} as Request, makeFile(filename, mime), (err, accepted) => {
      if (err) resolve({ accepted: false, error: err as Error });
      else resolve({ accepted: accepted === true });
    });
  });
}

describe('messengerFileFilter — 정상 케이스', () => {
  it('PDF — 허용', async () => {
    const r = await runFilter(messengerFileFilter, 'report.pdf', 'application/pdf');
    expect(r.accepted).toBe(true);
  });

  it('PNG — 허용', async () => {
    const r = await runFilter(messengerFileFilter, 'img.png', 'image/png');
    expect(r.accepted).toBe(true);
  });

  it('ZIP — 허용 (x-zip-compressed 변형 포함)', async () => {
    const r1 = await runFilter(messengerFileFilter, 'pack.zip', 'application/zip');
    const r2 = await runFilter(messengerFileFilter, 'pack.zip', 'application/x-zip-compressed');
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
  });

  it('대소문자 확장자 — 허용 (.PDF)', async () => {
    const r = await runFilter(messengerFileFilter, 'REPORT.PDF', 'application/pdf');
    expect(r.accepted).toBe(true);
  });
});

describe('messengerFileFilter — 차단 케이스', () => {
  it('확장자 화이트리스트에 없음 → 차단 (.exe)', async () => {
    const r = await runFilter(messengerFileFilter, 'virus.exe', 'application/x-msdownload');
    expect(r.accepted).toBe(false);
    expect(r.error?.message).toContain('지원하지 않는');
  });

  it('악성 MIME (실행 파일)이지만 확장자는 PDF → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'fake.pdf', 'application/x-msdownload');
    expect(r.accepted).toBe(false);
    expect(r.error?.message).toContain('실행 파일');
  });

  it('확장자와 MIME 불일치 (.pdf + image/png) → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'report.pdf', 'image/png');
    expect(r.accepted).toBe(false);
    expect(r.error?.message).toContain('일치하지 않습니다');
  });

  it('경로 traversal (..) 파일명 → 차단', async () => {
    const r = await runFilter(messengerFileFilter, '../../etc/passwd', 'text/plain');
    expect(r.accepted).toBe(false);
    expect(r.error?.message).toContain('사용할 수 없는 문자');
  });

  it('슬래시가 포함된 파일명 → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'sub/path.pdf', 'application/pdf');
    expect(r.accepted).toBe(false);
  });

  it('null byte가 포함된 파일명 → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'evil\x00.pdf', 'application/pdf');
    expect(r.accepted).toBe(false);
  });

  it('파일명 길이 > 255 → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'a'.repeat(256) + '.pdf', 'application/pdf');
    expect(r.accepted).toBe(false);
  });

  it('확장자 없는 파일 → 차단', async () => {
    const r = await runFilter(messengerFileFilter, 'README', 'text/plain');
    expect(r.accepted).toBe(false);
  });
});

describe('meetingFileFilter — zip/미디어 불허용', () => {
  it('PDF — 허용', async () => {
    const r = await runFilter(meetingFileFilter, 'slides.pdf', 'application/pdf');
    expect(r.accepted).toBe(true);
  });

  it('ZIP — meeting에서는 차단 (DOCUMENT_MIME만 허용)', async () => {
    const r = await runFilter(meetingFileFilter, 'pack.zip', 'application/zip');
    expect(r.accepted).toBe(false);
  });

  it('MP4 — meeting에서는 차단', async () => {
    const r = await runFilter(meetingFileFilter, 'demo.mp4', 'video/mp4');
    expect(r.accepted).toBe(false);
  });
});
