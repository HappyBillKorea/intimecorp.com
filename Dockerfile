# 외부 패키지를 쓰지 않는 단순한 서버라 설치 단계가 필요 없습니다.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
