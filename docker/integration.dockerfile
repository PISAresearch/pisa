FROM node:10.15.3
WORKDIR /usr/tests
COPY package*.json ./
RUN ["npm", "ci"];
COPY ./src ./src
COPY ./test ./test
COPY ./tsconfig.json ./tsconfig.json
ENTRYPOINT ["npm", "run", "testy"]