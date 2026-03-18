FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY test/ ./test/
RUN mkdir -p logs

CMD ["npm", "test"]
