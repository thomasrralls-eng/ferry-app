# gd ferry — Cloud Run scraper service
# Puppeteer + headless Chrome on Debian slim

FROM node:20-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json ./

# Copy only the packages we need (core, scraper, extension rules, cloud API)
COPY packages/core/ ./packages/core/
COPY packages/scraper/ ./packages/scraper/
COPY packages/extension/src/rules/ ./packages/extension/src/rules/
COPY packages/extension/package.json ./packages/extension/package.json
COPY packages/cloud/scraper-api/ ./packages/cloud/scraper-api/

# Install dependencies (workspace-aware)
RUN npm ci --workspace=packages/core \
           --workspace=packages/scraper \
           --workspace=packages/cloud/scraper-api \
           --omit=dev || npm install --workspace=packages/core \
                                     --workspace=packages/scraper \
                                     --workspace=packages/cloud/scraper-api \
                                     --omit=dev

# Install puppeteer in scraper package
RUN cd packages/scraper && npm install puppeteer@24 --save

EXPOSE 8080

CMD ["node", "packages/cloud/scraper-api/src/server.js"]
