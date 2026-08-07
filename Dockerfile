FROM node:18-alpine AS builder

WORKDIR /app

# Copy both apps
COPY apps/backend ./apps/backend
COPY apps/frontend ./apps/frontend
COPY package.json* ./

# Install dependencies and build
RUN cd apps/backend && npm install && npm run build
RUN cd apps/frontend && npm install && npm run build

# Production stage - backend
FROM node:18-alpine AS backend-prod

WORKDIR /app

COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package*.json ./
COPY --from=builder /app/apps/backend/prisma ./prisma

RUN npm ci --only=production

EXPOSE 3000

CMD ["npm", "start"]

# Production stage - frontend
FROM node:18-alpine AS frontend-prod

WORKDIR /app

COPY --from=builder /app/apps/frontend/dist ./dist
COPY --from=builder /app/apps/frontend/package*.json ./

RUN npm ci --only=production && npm install -g serve

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
