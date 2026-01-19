FROM oven/bun:latest

RUN apt-get update && apt-get install -y curl openssl && apt-get clean

WORKDIR /app
COPY . .

RUN chmod +x index.js

ENV PORT=10280

CMD ["bun", "index.js"]

