## Scripts to test mev-geth v0.2 ws capacity

Notes:
* Forked mev-geth master branch [here](https://github.com/taarushv/mev-geth) to add a `getTxPoolBundlesCount` RPC method which returns the count of bundles currently in mev-geth's txpool

    * See code [diff](https://github.com/flashbots/mev-geth/compare/master...taarushv:master)
    * Ex: `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_getTxPoolBundlesCount","params":[],"id":67}' http://localhost:8545` 
        * returns: `{"jsonrpc":"2.0","id":67,"result":0}`
* The script sends sample bundles and has 3 main params:
    * `bundlesPerMin`, `testDurationInMins`, `dataCheckpointInterval`
    * Relay bundles data indicates ~2M bundles forwarded to miners in the last week, comes down to ~200 bundles/min
        * Default params: 
            * `bundlesPerMin` = 200
            * `testDurationInMins` = 30
            * `dataCheckpointInterval` = 1, saves bundles sent/received by client stats to `/data/logs.json`

* Instructions: 
    * Clone this repo and install deps:
        * `git clone https://github.com/taarushv/v0.2-bundle-flow-tests.git`
        * `cd v0.2-bundle-flow-tests && yarn`
    * Clone mev-geth (with rpc required for testing) in the root folder of this repo:
        * `git clone https://github.com/taarushv/mev-geth.git`
        * `cd mev-geth`
        * `rm -rf datadir/ && make geth && ./build/bin/geth init --datadir datadir ../genesis.json`
    * Start mev-geth:
        * `./build/bin/geth --datadir datadir --rpc --rpcapi debug,personal,eth,net,web3,txpool,admin,miner --miner.etherbase=0xd912aecb07e9f4e1ea8e6b4779e7fb6aa1c3e4d8 --miner.gasprice 0 --mine --miner.threads=8 --relaywsurl="localhost:8080" --relaywssigningkeystorefile="../sample_keystore_file" --relaywskeystorepw="randomWalletPW"`
    * Start test script:
        * `cd ../ && yarn run start`

Once complete, the logs should look something like this (for a 30 min test): 

```
    {
      "id": 2,
      "config": {
        "bundlesPerMin": 200,
        "testDurationInMins": 30,
        "dataCheckpointInterval": 1,
        "startedAt": 1621387753
      },
      "status": {
        "lastUpdated": 1621389774,
        "bundlesSent": 6000,
        "bundlesReceived": 6000,
        "successRate": 100,
        "completed": true
      }
    }
```
 
It does not show any indication of bundles being dropped (100% rate) or the ws server/client having any errors

Next steps:
* Running this for longer durations, ~8 hours to ~1 day (WIP)
* Docker compose file to automate this
* Adding another PoW mev-geth client, peering them and seeing what success rate is like when sending ws messages to multiple miners
