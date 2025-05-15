# Base image: Node.js 22 Slim
FROM node:22-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install build tools needed for native modules like better-sqlite3
# And then clean up apt lists to keep image size smaller
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install production dependencies
# --omit=dev ensures only runtime dependencies are installed, keeping the image smaller.
RUN npm install --omit=dev

# Copy the rest of the application source code
# This includes backend .js files and the 'public' directory for frontend assets.
COPY . .

# Rebuild native modules like better-sqlite3 to match the container's Node.js environment
RUN npm rebuild better-sqlite3 --build-from-source

# Expose the port the app will run on (this should match the PORT env var)
# The actual port mapping to the host is done in docker-compose.yml or `docker run -p`
EXPOSE 3000

# Define the command to run the application
# This assumes your main server file is app.js
CMD ["node", "app.js"]
