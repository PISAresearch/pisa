######################
####### BUILD ########
######################
FROM node:10.14.2 as builder
WORKDIR /usr/pisa

# copy the package files
COPY package*.json ./
COPY ./packages ./packages
COPY ./tsconfig*.json ./
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