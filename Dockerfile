# Stage 1: Build static assets
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files first for caching
COPY package.json package-lock.json ./

# Install dependencies using clean install
RUN npm ci

# Copy the rest of the application source code (including packages/sdk)
COPY . .
RUN mkdir -p node_modules/@superlexicon && ln -sfn ../../packages/sdk node_modules/@superlexicon/sdk

# Compile the production assets
RUN npm run build

# Stage 2: Serve the compiled site using hardened Nginx configuration
FROM nginx:alpine

# Install hardened Nginx server config (hides server_tokens, adds security headers & blocks dotfiles)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose Nginx default HTTP port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
