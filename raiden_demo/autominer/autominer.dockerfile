FROM node:10.15.3
COPY package*.json ./
RUN ["npm", "ci"];
RUN ["npm", "i", "-g", "ts-node"];
COPY . .
ENTRYPOINT ["ts-node", "autominer.ts", "--period", "1000", "--jsonrpcurl", "http://parity:8545"]