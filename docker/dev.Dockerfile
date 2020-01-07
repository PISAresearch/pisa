######################
####### BUILD ########
######################
FROM node:10.14.2 as dev
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./

# copy the src and the configs
COPY ./packages ./packages
COPY ./tsconfig*.json ./
COPY ./lerna.json ./lerna.json

# install packages
RUN ["npm", "i"]

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
CMD ["node", "./dist/startUp.js"]