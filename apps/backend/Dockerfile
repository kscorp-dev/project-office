# ── Backend Dockerfile (multi-stage) ──

# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# 의존성 설치 (devDeps 포함 — 빌드에 필요)
COPY package.json package-lock.json* tsconfig.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

# 소스 빌드
COPY src ./src/
RUN npm run build

# ---- Stage 2: Production deps only ----
FROM node:20-alpine AS deps

RUN apk add --no-cache openssl

WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# production 의존성만 설치 (devDeps 제외 → 이미지 크기 30%+ 감소)
RUN npm ci --omit=dev
RUN npx prisma generate

# ---- Stage 3: Runtime ----
FROM node:20-alpine

RUN apk add --no-cache openssl wget

WORKDIR /app
ENV NODE_ENV=production

# 빌드 결과와 production node_modules만 복사
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

RUN mkdir -p uploads

# 비루트 유저로 실행 (Alpine의 기본 node 유저 사용)
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Prisma migrations 적용 후 서버 기동
# (prisma/migrations/ 디렉토리에 .sql 파일이 있어야 migrate deploy가 작동)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
