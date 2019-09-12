######################
####### build ########
######################
FROM node:10.14.2 as builder
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./

# install packages
RUN ["npm", "ci", "--only=prod"];
# we need truffle to compile contracts needed in production
# but we dont want to ship truffle into production, so we dont include it in the production packages section
RUN ["npm", "i", "-g", "truffle"];

# copy the src and the configs
COPY ./src ./src
COPY ./sol ./sol
COPY ./tsconfig.json ./tsconfig.json

# build
RUN ["npm", "run", "build"]

######################
####### DEPLOY #######
######################
FROM node:10.14.2 as deploy
WORKDIR /usr/pisa

# copy config
COPY ./configs/pisa.json ./build/src/config.json
# copy only the source code from the builder
COPY --from=builder /usr/pisa/build/src ./build/src
# copy node modules from production
COPY --from=builder ./usr/pisa/node_modules ./node_modules

# expose the startup port
EXPOSE 3000
# start the application
# we cant use npm run start since it causes problems with graceful exit within docker
# see https://medium.com/@becintec/building-graceful-node-applications-in-docker-4d2cd4d5d392 for more details
CMD ["node", "./build/src/startUp.js"]