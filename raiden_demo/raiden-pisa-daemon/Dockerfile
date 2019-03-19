FROM node:10.15.3

COPY package*.json ./

RUN ["npm", "ci"];

COPY . .

ENTRYPOINT ["npm", "run", "start"]
