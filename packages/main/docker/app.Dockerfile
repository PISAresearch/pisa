######################
####### BUILD ########
######################
FROM node:10.14.2 as builder
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./

# install packages
RUN ["npm", "ci"];

# copy the src and the configs
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

# build
RUN ["npm", "run", "build"]

########################################
####### PRODUCTION PACKAGES ONLY #######
########################################
# start a new stage, we dont need to carry over all the unused precompiled code and dev dependencies
FROM node:10.14.2 as productionPackges
WORKDIR /usr/pisa

# copy packages
COPY package*.json ./
# install production dependencies
RUN ["npm", "ci", "--only=prod"];

######################
####### DEPLOY #######
######################
FROM node:10.14.2 as deploy
WORKDIR /usr/pisa

# copy packages
COPY package*.json ./
# copy config
COPY ./configs/pisa.json ./lib/config.json
# copy only the source code from the builder
COPY --from=builder /usr/pisa/lib ./lib
# copy node modules from production
COPY --from=productionPackges /usr/pisa/node_modules ./node_modules

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./lib/startUp.js"]