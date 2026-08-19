FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run typecheck
EXPOSE 8080
CMD ["npm", "run", "runtime:worker"]
