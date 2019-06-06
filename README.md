[![CircleCI](https://circleci.com/gh/PISAresearch/pisa.svg?style=shield)](https://circleci.com/gh/PISAresearch/pisa)
[![codecov](https://codecov.io/gh/PISAresearch/pisa/branch/master/graph/badge.svg)](https://codecov.io/gh/PISAresearch/pisa)


# PISA - An Accountable Watching Service

PISA is a solution to help alleviate the online requirement for smart contracts.

It was first devised for off-chain protocols, where PISA could be hired to watch for challenges on behalf of its customer. However, in a very generic sense, PISA can be hired to watch any smart contract when a user must respond within a fixed time period to an on-chain event. 

Our infrastructure focuses on supporting several smart contracts including off-chain channels, plasma, auctions, e-voting, makerdao, etc. 

We are working to minimise all integration effort - in the best case a smart contract may just need to post "logs" to a data registry - and we'll take care of the rest! 


## PISA to the rescue - fixing the bad UX for 2 step protocols


As a protocol designer, we love building protocols using commit and reveal to guarantee fairness. Good examples include auctions (seal bid, reveal bid), games (submit sealed choice, reveal choice), and e-voting (submit sealed vote, reveal vote). But so far, the UX around two-step protocols are really bad and users have lost money.

**Why is commit and reveal a bad user experience?** Typically commit and reveal protocols have two time periods. 

* Users "commit" to their choice (all must commit before time t1))
* Users "reveal" their choice (all must reveal before time t2) 

Requiring users *to be online* within both time periods doesn't translate well to the real world - people can easily busy and just forget to respond - sometimes if they forget, the protocol will slash them and make them lose their deposit. Not a great UX outcome, but a necessary evil in protocol design. 


## How is PISA "Accountable"? 

When PISA is hired by the customer, we provide the custoer with a signed receipt that proves we accepted the job. If we fail to respond on their behalf, then the customer can use on-chain evidence (via the DataRegistry) and the signed receipt as indisputable evidence of our wrongdoing. 

*Two outcomes if we fail*. Either the customer is refunded within a fixed time period (based on what we promised in advance) or eventually the customer can slash our security deposit. 

We always have an opportunity to make right our mistake and refund the customer - but ultimately we are financially accountable for the mistake. Thus the customer does NOT have to blindly trust us! 

## When can I start using PISA? 

We are currently working on the implementation and a set of standards to minimise integration efforts with us. If you want to partner with us such that your customers can hire PISA to respond on their behalf - please contact us at paddy@pisa.watch and check out the following standards (we will update this list as more are posted):

* Data Registry (log events) - https://github.com/ethereum/EIPs/pull/2095 
* Example of contract logging events (super simple) - https://github.com/PISAresearch/pisa/blob/master/sol/contracts/ChallengeClosureContract.sol 
