FROM node:10.15.3
COPY package*.json ./
RUN ["npm", "ci"];
RUN ["npm", "i", "-g", "ts-node"];
COPY . .
ENTRYPOINT ["ts-node", "coinminter.ts", "--account1", "b457aed7a81d0428fe54087af80099fcf27e2782", "--account2",  "f0afbed24d88ce4cb12828984bb10d2f1ad0e185", "--jsonrpcurl", "http://parity:8545"]