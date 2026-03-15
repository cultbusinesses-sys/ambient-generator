FROM node:20-slim

# Install ffmpeg and canvas dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json ./

# Install Node dependencies
RUN npm install --production

# Copy server source
COPY . .

# Railway sets PORT automatically
ENV PORT=3001
ENV TEMP_DIR=/tmp
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "index.js"]
