FROM node:20-alpine

# Security: create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ghostdrop -u 1001 -G nodejs

WORKDIR /app

# Install dependencies first (layer caching)
COPY backend/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application source
COPY backend/src ./src
COPY backend/sql ./sql
COPY frontend ./frontend

# Create logs directory with correct permissions
RUN mkdir -p logs && chown -R ghostdrop:nodejs /app

# Switch to non-root user
USER ghostdrop

# Health check — verifies the server and database are up
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "\
    const http = require('http'); \
    const req = http.get('http://localhost:' + (process.env.PORT || 4000) + '/api/health', (r) => { \
      if (r.statusCode === 200) process.exit(0); else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.setTimeout(4000, () => { req.abort(); process.exit(1); }); \
  "

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "src/app.js"]
