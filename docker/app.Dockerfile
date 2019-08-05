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
COPY ./raiden_demo ./raiden_demo
COPY ./test ./test
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
COPY ./configs/pisa.json ./build/src/config.json
# copy only the source code from the builder
COPY --from=builder /usr/pisa/build/src ./build/src
COPY --from=builder /usr/pisa/build/raiden_demo ./build/raiden_demo
# copy node modules from production
COPY --from=productionPackges ./usr/pisa/node_modules ./node_modules
# copy the smoke tests
COPY --from=builder /usr/pisa/build/test/smoke ./build/test/smoke

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./build/src/startUp.js"]

######################
####### test #######
######################
FROM node:10.14.2 as test
WORKDIR /usr/pisa

# copy packages
COPY package*.json ./
# copy config
COPY ./configs/test.json ./build/src/config.json
# copy external dependencies
COPY ./statechannels/build ./build/statechannels/build
# copy only the source code from the builder
COPY --from=builder ./usr/pisa/build ./build
# copy node modules from dev
COPY --from=builder ./usr/pisa/node_modules ./node_modules

# run load tests
CMD ["npm", "run", "test-load"]