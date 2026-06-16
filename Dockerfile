FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./
RUN npm install

COPY src ./src
COPY config ./config
COPY README.md ./

ENV PDL_COMPANY_CSV=/data/free_company_dataset.csv
ENV CRAWL_BACKEND=local
ENV CRAWL_CONCURRENCY=2

CMD ["npm", "run", "profile"]
