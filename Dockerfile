FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY README.md ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8788

EXPOSE 8788

CMD ["npm", "start"]
