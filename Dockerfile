FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm ci
RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Install necessary packages for networking and stdio handling
RUN apk add --no-cache dumb-init

# Copy package files and install only production dependencies
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

ENV DISCORD_TOKEN=""
ENV DISCORD_GUILD_ID=""
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Use dumb-init to handle signals properly for stdio transport
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/index.js"]
