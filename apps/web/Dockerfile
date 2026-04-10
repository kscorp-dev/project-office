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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
