FROM node:24-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@10.24.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY config ./config
COPY README.md ./

ENV PDL_COMPANY_CSV=/data/free_company_dataset.csv
ENV CRAWL_BACKEND=local
ENV CRAWL_CONCURRENCY=2

CMD ["pnpm", "fcdx", "--help"]
