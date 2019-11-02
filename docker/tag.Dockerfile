# ######################
# ####### BUILD ########
# ######################
# FROM node:10.14.2 as builder
# WORKDIR /usr/pisa

# # copy the package files
# COPY package*.json ./

# # install packages
# # RUN ["npm", "ci"];
# RUN ["npm", "i", "-D", "lerna@3.18.3"]

# # copy the src and the configs
# COPY ./packages ./packages
# COPY ./tsconfig.json ./tsconfig.json
# COPY ./lerna.json ./lerna.json

# # build
# RUN ["npm", "run", "bootstrap"]
# RUN ["npm", "run", "build"]

# ########################################
# ####### PRODUCTION PACKAGES ONLY #######
# ########################################
# # start a new stage, we dont need to carry over all the unused precompiled code and dev dependencies
# FROM node:10.14.2 as productionPackages
# WORKDIR /usr/pisa

# # copy packages
# COPY package*.json ./
# COPY ./lerna.json ./lerna.json
# RUN ["npm", "i", "-D", "lerna@3.18.3"]
# # install production dependencies
# COPY ./packages ./packages
# RUN ["npm", "run", "bootstrap-ci"];

# ######################
# ####### DEPLOY #######
# ######################
# FROM node:10.14.2 as deploy
# WORKDIR /usr/pisa

# # copy packages
# COPY packages/server/package*.json ./
# # copy config
# COPY ./configs/pisa.json ./lib/config.json
# # copy only the source code from the builder
# COPY --from=builder /usr/pisa/packages/server/lib ./lib
# # copy node modules from production
# COPY --from=productionPackages /usr/pisa/packages/server/node_modules ./node_modules

# # expose the startup port
# EXPOSE 3000
# # start the application
# # we cant use npm run start since it causes problems with graceful exit within docker
# # see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
# CMD ["node", "./lib/startUp.js"]


######################
####### BUILD ########
######################
# FROM node:10.14.2 as dev
# WORKDIR /usr/pisa

# # copy the package files
# COPY package*.json ./

# # install packages
# RUN ["npm", "i", "-D", "lerna@3.18.3"]

# # copy the src and the configs
# COPY ./packages ./packages
# COPY ./tsconfig.json ./tsconfig.json
# COPY ./lerna.json ./lerna.json

# # build
# RUN ["npm", "run", "bootstrap"]
# RUN ["npm", "run", "build"]

# # create a lib directory and symlink to the one in the server packages
# # we do this to remain consisten with the file structure of the production docker image
# RUN ["ln", "-s", "./packages/server", "./server"]

# # expose the startup port
# EXPOSE 3000
# # start the application
# # we cant use npm run start since it causes problems with graceful exit within docker
# # see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
# CMD ["node", "./server/lib/startUp.js"]

######################
####### BUILD ########
######################
FROM node:10.14.2 as builder
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./
COPY ./packages ./packages
COPY ./tsconfig.json ./tsconfig.json
COPY ./lerna.json ./lerna.json
RUN ["npm", "i", "-g", "lerna"]
RUN ["npm", "run", "bootstrap"]

# install and build
WORKDIR /usr/pisa/packages/server
RUN ["npm", "ci"]
RUN ["npm", "run", "build"]

######################
####### PROD PACKAGES ########
######################
FROM node:10.14.2 as productionPackages
WORKDIR /usr/pisa

# copy the package files
COPY packages/server/package*.json ./

# install only prod
RUN ["npm", "ci", "--only=prod"]

######################
####### deploy ########
######################
FROM node:10.14.2 as deploy
WORKDIR /usr/pisa

COPY --from=builder /usr/pisa/packages/server/lib ./server/lib
COPY --from=productionPackages /usr/pisa/node_modules ./node_modules

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./server/lib/startUp.js"]