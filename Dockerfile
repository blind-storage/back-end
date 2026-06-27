FROM node:22-alpine AS deps
WORKDIR /workspace/backend
COPY types/ /workspace/types/
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /workspace/backend
COPY --from=deps /workspace/types /workspace/types
COPY --from=deps /workspace/backend/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /workspace/backend/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /workspace/backend/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /workspace/backend/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /workspace/backend/package.json ./
COPY --chown=nestjs:nodejs entrypoint.sh ./
RUN chmod +x entrypoint.sh
USER nestjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
