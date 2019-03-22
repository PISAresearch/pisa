FROM node:10.15.3
COPY package*.json ./
RUN ["npm", "ci"];
RUN ["npm", "i", "-g", "ts-node"];
COPY . .
ENTRYPOINT ["ts-node", "coinminter.ts", "--account1", "b457aed7a81d0428fe54087af80099fcf27e2782", "--account2",  "f0afbed24d88ce4cb12828984bb10d2f1ad0e185", "--jsonrpcurl", "http://parity:8545"]


# ts-node coinminter.ts --account1 b457aed7a81d0428fe54087af80099fcf27e2782 --account2 f0afbed24d88ce4cb12828984bb10d2f1ad0e185 --jsonrpcurl http://localhost:8545 --tokenAddress 0xB2B506fa29DE60E21A9406c82c1B9F0da8D9cAF1
# ts-node coinminter.ts --account1 aaa33fd8d0cc3bf0054fe3a11567b99ef9640b3a --account2 bbb1c891ccd690ac0eaf850822750e9d189a0055 --jsonrpcurl http://localhost:8545 --tokenAddress 0xB2B506fa29DE60E21A9406c82c1B9F0da8D9cAF1
# ts-node coinminter.ts --account1 ccca21b97b27defc210f01a7e64119a784424d26 --account2 dddec4d561ee68f37855fa3245cb878b10eb1fa0 --jsonrpcurl http://localhost:8545 --tokenAddress 0xB2B506fa29DE60E21A9406c82c1B9F0da8D9cAF1

# aaa33fd8d0cc3bf0054fe3a11567b99ef9640b3a
# bbb1c891ccd690ac0eaf850822750e9d189a0055
# ccca21b97b27defc210f01a7e64119a784424d26
# dddec4d561ee68f37855fa3245cb878b10eb1fa0