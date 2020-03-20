FROM node:11.9.0 as pnpm
ENV PNPM_VERSION 4.11.6 # Control pnpm version dependency explicitly
RUN curl -sL https://unpkg.com/@pnpm/self-installer | node

######################
####### BUILD ########
######################
FROM pnpm as dev
WORKDIR /usr/pisa

# copy the package files
COPY package.json ./
COPY pnpm-lock.yaml ./

# copy the src and the configs
COPY ./packages ./packages
COPY ./tsconfig*.json ./
COPY ./lerna.json ./lerna.json

# install packages
RUN ["pnpm", "i", "--frozen-lockfile"]

# build
RUN ["npm", "run", "build"]

# create a lib directory and symlink to the one in the server packages
# we do this to remain consistent with the file structure of the production docker image
RUN ["ln", "-s", "./packages/server/lib", "./dist"]

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./dist/index.js"]