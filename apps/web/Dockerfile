# ── Web Frontend Dockerfile ──
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./
RUN npm install

COPY index.html ./
COPY public ./public/
COPY src ./src/

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ── Nginx Production ──
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 비루트 nginx 사용 — alpine 의 nginx 이미지는 nginx 유저가 이미 정의됨
# nginx 마스터는 권한 강등 위해 root 가 필요했으나, daemon off + 비루트 포트(80→8080) 패턴으로 해결
# alpine nginx 1.21+ 는 nginx-unprivileged 변형 가능 — 여기선 단순히 USER nginx + writable dirs
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    # PID 위치 변경 (root 권한 필요한 /var/run/nginx.pid 대신 사용자 dir)
    && sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
    # listen 80 → 8080 (1024 미만 포트는 root 필요)
    && sed -i 's/listen 80;/listen 8080;/' /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
