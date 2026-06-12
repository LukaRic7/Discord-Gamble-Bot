FROM node:20-bookworm

WORKDIR /app

# install build tools (required for compiling sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev && npm rebuild sqlite3 --build-from-source

COPY . .

ENV NODE_ENV=production

CMD ["node", "src/index.js"]