FROM node:18-alpine

WORKDIR /src/app

COPY package.json package-lock.json ./
RUN npm ci --omit dev

COPY . ./

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["./src/server.js"]
