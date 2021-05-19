Init client: `rm -rf datadir/ && make geth && ./build/bin/geth init --datadir datadir ../genesis.json`

Run: `./build/bin/geth --datadir datadir --rpc --rpcapi debug,personal,eth,net,web3,txpool,admin,miner --miner.etherbase=0xd912aecb07e9f4e1ea8e6b4779e7fb6aa1c3e4d8 --miner.gasprice 0 --mine --miner.threads=8 --relaywsurl="localhost:8080" --relaywssigningkeystorefile="../sample_keystore_file" --relaywskeystorepw="randomWalletPW"`



