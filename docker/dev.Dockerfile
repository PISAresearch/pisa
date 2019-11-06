######################
####### BUILD ########
######################
FROM node:10.14.2 as dev
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./

# install packages
RUN ["npm", "i", "-D", "lerna@3.18.3"]

# copy the src and the configs
COPY ./packages ./packages
COPY ./tsconfig*.json ./
COPY ./lerna.json ./lerna.json

# build
RUN ["npm", "run", "bootstrap"]
RUN ["npm", "run", "build"]

# create a lib directory and symlink to the one in the server packages
# we do this to remain consisten with the file structure of the production docker image
RUN ["ln", "-s", "./packages/server", "./server"]

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./server/lib/startUp.js"]



# option1 add the whole context, install lerna, install the dev context

# option2 - add only the server as context, install dev, build, copy to prod image, install prod
