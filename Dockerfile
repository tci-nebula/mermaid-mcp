FROM node:20-slim

# System Chromium for mermaid-cli's Puppeteer, plus CJK fonts so
# Japanese/Chinese/Korean diagram labels render correctly.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js drawio.js puppeteer-config.json ./
ENV MERMAID_PUPPETEER_CONFIG=/app/puppeteer-config.json

USER node
ENTRYPOINT ["node", "server.js"]
