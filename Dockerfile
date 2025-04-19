FROM public.ecr.aws/lambda/nodejs:18

# Copy package files
COPY package*.json ./

# Install dependencies (using npm install instead of ci since we don't have lock file)
RUN npm install --production

# Copy function code
COPY index.js ./

# Set the CMD to your handler
CMD [ "index.handler" ]