import path from 'path';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';

/**
 * 확장자 ↔ MIME 타입 화이트리스트
 *
 * 방어 계층:
 * 1) 확장자가 허용 목록에 포함되는지 검증
 * 2) MIME 타입이 해당 확장자의 정상 MIME 후보 중 하나인지 교차 검증
 *    (공격자가 evil.exe → evil.pdf로 이름 변경해도, 브라우저가 보낸 MIME은
 *     application/octet-stream 등이 되어 교차 검증에서 차단됨)
 *
 * 주의: multer의 fileFilter는 파일 본문을 읽기 전에 호출되므로 magic bytes 검사는
 * 여기서 수행할 수 없다. 추가 방어가 필요하면 업로드 후 스트림 파이프라인에서
 * file-type 등을 이용해 이진 시그니처 검사를 추가할 것.
 */

type MimeMap = Record<string, readonly string[]>;

// 이미지
const IMAGE_MIME_MAP: MimeMap = {
  '.jpg':  ['image/jpeg', 'image/jpg'],
  '.jpeg': ['image/jpeg', 'image/jpg'],
  '.png':  ['image/png'],
  '.gif':  ['image/gif'],
  '.webp': ['image/webp'],
  '.svg':  ['image/svg+xml'],
};

// 문서
const DOCUMENT_MIME_MAP: MimeMap = {
  '.pdf':  ['application/pdf'],
  '.doc':  ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls':  ['application/vnd.ms-excel', 'application/msexcel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt':  ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt':  ['text/plain'],
  '.csv':  ['text/csv', 'application/vnd.ms-excel', 'application/csv'],
  '.hwp':  ['application/x-hwp', 'application/haansofthwp', 'application/octet-stream'],
};

// 아카이브
const ARCHIVE_MIME_MAP: MimeMap = {
  '.zip':  ['application/zip', 'application/x-zip-compressed'],
};

// 미디어
const MEDIA_MIME_MAP: MimeMap = {
  '.mp4':  ['video/mp4'],
  '.mp3':  ['audio/mpeg', 'audio/mp3'],
};

const MESSENGER_MIME_MAP: MimeMap = {
  ...IMAGE_MIME_MAP,
  ...DOCUMENT_MIME_MAP,
  ...ARCHIVE_MIME_MAP,
  ...MEDIA_MIME_MAP,
};

const MEETING_DOC_MIME_MAP: MimeMap = {
  ...IMAGE_MIME_MAP,
  ...DOCUMENT_MIME_MAP,
};

/**
 * 위험한 실행 파일 확장자 (이름이 .pdf여도 MIME이 이것 중 하나면 차단)
 */
const DANGEROUS_MIMES = new Set([
  'application/x-msdownload',       // .exe
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',               // .sh
  'application/x-bash',
  'application/javascript',         // .js (스크립트)
  'text/javascript',
  'application/x-httpd-php',        // .php
]);

/**
 * 이름에 유효하지 않은 문자 검사 (경로 traversal 방지)
 */
function hasInvalidFilename(name: string): boolean {
  if (!name || name.length > 255) return true;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return true;
  // null byte, control char
  if (/[\x00-\x1f]/.test(name)) return true;
  return false;
}

/**
 * 확장자+MIME 교차 검증 fileFilter 팩토리
 */
function makeFileFilter(map: MimeMap): (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => void {
  return (_req, file, cb) => {
    const originalName = file.originalname || '';

    if (hasInvalidFilename(originalName)) {
      return cb(new Error('파일명에 사용할 수 없는 문자가 포함되어 있습니다'));
    }

    const ext = path.extname(originalName).toLowerCase();
    const allowedMimes = map[ext];

    if (!allowedMimes) {
      return cb(new Error(`지원하지 않는 파일 형식입니다 (${ext})`));
    }

    const mime = (file.mimetype || '').toLowerCase();

    if (DANGEROUS_MIMES.has(mime)) {
      return cb(new Error('실행 파일은 업로드할 수 없습니다'));
    }

    if (!allowedMimes.includes(mime)) {
      return cb(new Error(`파일 형식과 내용이 일치하지 않습니다 (ext=${ext}, mime=${mime})`));
    }

    cb(null, true);
  };
}

export const messengerFileFilter = makeFileFilter(MESSENGER_MIME_MAP);
export const meetingFileFilter = makeFileFilter(MEETING_DOC_MIME_MAP);
// 결재 첨부 — 미디어는 불필요, 이미지+문서+아카이브만
const APPROVAL_MIME_MAP: MimeMap = {
  ...IMAGE_MIME_MAP,
  ...DOCUMENT_MIME_MAP,
  ...ARCHIVE_MIME_MAP,
};
export const approvalFileFilter = makeFileFilter(APPROVAL_MIME_MAP);

// 필요 시 다른 라우트에서 map만 조합해서 쓸 수 있도록 export
export { IMAGE_MIME_MAP, DOCUMENT_MIME_MAP, ARCHIVE_MIME_MAP, MEDIA_MIME_MAP, makeFileFilter };
