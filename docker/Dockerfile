FROM node:22-slim
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
RUN npm install -g openclaw@latest && npm cache clean --force
RUN mkdir -p /root/.openclaw/canvas /root/.openclaw/cron
ENV AWS_REGION=us-east-1
EXPOSE 20206
CMD ["openclaw", "gateway", "--port", "20206"]
