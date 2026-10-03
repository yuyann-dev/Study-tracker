# ---- 构建阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app

# 安装编译 better-sqlite3 所需的构建工具
RUN apk add --no-cache python3 make g++

# 复制 package.json 并安装依赖
COPY backend/package.json ./
RUN npm install --production

# ---- 运行阶段 ----
FROM node:20-alpine AS runner

WORKDIR /app

# 安装运行时所需的最小依赖（better-sqlite3 需要 libstdc++）
RUN apk add --no-cache libstdc++ tini

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 从构建阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制后端代码
COPY backend/ ./

# 创建必要目录并设置权限
RUN mkdir -p data logs uploads && \
    chown -R nodejs:nodejs /app

USER nodejs

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3001

# 使用 tini 作为 PID 1，正确处理信号
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
