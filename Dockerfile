#Use an official Node.js runtime as the base image
FROM node:18
# Set max heap size to 4GB (4096 MB)
ENV NODE_OPTIONS="--max-old-space-size=9216"
# Set the working directory in the container
WORKDIR /app
# Copy package.json and package-lock.json files
COPY package*.json ./
# Install dependencies
RUN npm install
# Copy the rest of the application code
COPY . .
# Set environment variables
ENV NODE_ENV=production
# Expose the port the app runs on
EXPOSE 5015
# Start the application
CMD ["npm", "start"]
