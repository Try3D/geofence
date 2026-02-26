FROM --platform=linux/amd64 oven/bun:1.2

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "src/server.ts"]
