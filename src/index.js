const FlashbotsBundleProvider = require('@flashbots/ethers-provider-bundle').FlashbotsBundleProvider
const ethers = require('ethers')
const ethUtil = require('ethereumjs-util')
const WebSocket = require('ws')
const _ = require('lodash')
const axios = require('axios')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('./data/logs.json')
const db = low(adapter)
db.defaults({ testReports: [], testsRun: 0 }).write()

const bundlesPerMin = 200 // bundles to send out every min
const testDurationInMins = 30 // total test duration
const dataCheckpointInterval = 1 // writes status to logs every minute

// miner pk on the private network
const FAUCET = '0x133be114715e5fe528a1b8adf36792160601a2d63ab59d1fd454275b31328791'
const DUMMY_RECEIVER = '0x1111111111111111111111111111111111111111' // address we'll send funds via bundles
const wss = new WebSocket.Server({ port: 8080 })
const simpleProvider = new ethers.providers.JsonRpcProvider('http://localhost:8545')
const flashBotsProvider = new FlashbotsBundleProvider(simpleProvider, 'http://localhost:8545')
// we use the miner as a faucet for testing
const faucet = new ethers.Wallet(FAUCET, simpleProvider)
// we create a random user who will submit bundles
const user = ethers.Wallet.createRandom().connect(simpleProvider)
const bribe = ethers.utils.parseEther('0.02')

console.log('Starting ws server')

const initTestRun = () => {
  db.update('testsRun', n => n + 1).write()
  const id = db.get('testsRun').value()
  const now = parseInt(Date.now() / 1000) // timestamp
  const report = {
    id: id,
    config: {
      bundlesPerMin: bundlesPerMin,
      testDurationInMins: testDurationInMins,
      dataCheckpointInterval: dataCheckpointInterval,
      startedAt: now
    },
    status: {
      lastUpdated: now, // timestamp
      bundlesSent: 0, // bundles sent to the writer so far
      bundlesReceived: 0, // bundles received by the client
      successRate: 0, // % of bundles received by client
      completed: false
    }
  }
  db.get('testReports').push(report).write()
  return id
}
// curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_getTxPoolBundlesCount","params":[],"id":67}'
const getBundlesInTxPool = async () => {
  const reqBody = {
    jsonrpc: '2.0',
    method: 'eth_getTxPoolBundlesCount',
    params: [],
    id: parseInt(Date.now() / 1000)
  }
  const res = await axios.post('http://localhost:8545', reqBody)
  return res.data.result
}

// Helper functions
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Set heartbeat
function heartbeat () {
  // console.log("received: pong")
  this.isAlive = true
}

// WS related handlers
wss.on('connection', async function connection (ws, req) {
  ws.isAlive = true
  ws.on('pong', heartbeat)
  ws.on('message', message => {
    console.log('received message from ws client: ' + message)
  })
  if (req.headers['x-auth-message']) {
    const parsedAuthMessage = JSON.parse(req.headers['x-auth-message'])
    console.log(parsedAuthMessage)
    if (isValidSignature(parsedAuthMessage.signature, parsedAuthMessage.timestamp)) {
      console.log('successful connection, initiating test run')
      // log params here
      startTest(ws)
    } else {
      console.log('auth failed')
      ws.terminate()
    }
  } else {
    ws.terminate()
  }
  ws.on('close', m => {
    console.log('client closed ' + m)
  })
})

// Heartbeat test to see if connection is still alive every 10 seconds
const interval = setInterval(function ping () {
  wss.clients.forEach(function each (ws) {
    if (ws.isAlive === false) { return ws.terminate() }
    ws.isAlive = false
    ws.ping(() => {
      // console.log("sending: ping")
    })
  })
}, 10000)

wss.on('close', function close () {
  clearInterval(interval)
})

const whitelistedAddresses = ['0x908e8902bd2018d3bf4d5a0fb42a457e1e8f1a6e'] // EAO address, 0x trimmed

const timeoutRange = 5
const isValidTimestamp = (timestamp) => {
  const dateObj = new Date(timestamp)
  const currentTime = new Date()
  const lowerBound = new Date(currentTime.getTime() - timeoutRange * 60000).getTime() // +- 5 mins UTC, to account for clock syncing
  const upperBound = new Date(currentTime.getTime() + timeoutRange * 60000).getTime() // 60000 for mins => ms
  return dateObj.getTime() >= lowerBound && dateObj.getTime() <= upperBound
}

const isValidSignature = (signature, message) => {
  try {
    const messageHash = ethers.utils.arrayify(ethers.utils.id(message))
    const parsedSignature = ethUtil.fromRpcSig(signature)
    const recoveredAddress = '0x' + ethUtil.pubToAddress(ethUtil.ecrecover(messageHash, parsedSignature.v, parsedSignature.r, parsedSignature.s)).toString('hex')
    console.log(recoveredAddress)
    if (_.includes(whitelistedAddresses, recoveredAddress) && isValidTimestamp(parseInt(message) * 1000)) {
      return true
    } else {
      return false
    }
  } catch (error) {
    console.log(error)
    return false
  }
}

const generateTestBundle = async () => {
  const nonce = await user.getTransactionCount()
  const txs = [
    // some transaction
    {
      signer: user,
      transaction: {
        to: DUMMY_RECEIVER,
        value: ethers.utils.parseEther('0.05'),
        nonce: nonce
      }
    },
    // the miner bribe
    {
      signer: user,
      transaction: {
        to: faucet.address,
        value: bribe,
        nonce: nonce + 1
      }
    }
  ]
  console.log('Submitting bundle')
  const blk = await simpleProvider.getBlockNumber()

  const targetBlockNumber = blk + 5000000 // targetting blocks far ahead to ensure client holds all bundles for the duration of the test
  const payload = {
    data: {
      encodedTxs: await flashBotsProvider.signBundle(txs),
      blockNumber: `0x${targetBlockNumber.toString(16)}`,
      minTimestamp: 0,
      maxTimestamp: 0,
      revertingTxHashes: []
    },
    type: 'bundle'
  }
  return payload
}

const sendBundles = async (totalBundles, ws, id, check) => {
  for (let i = 0; i < totalBundles; i++) {
    const payload = await generateTestBundle()
    ws.send(JSON.stringify(payload))
    if (((i + 1) % (dataCheckpointInterval * bundlesPerMin) === 0) && i !== 0) {
      if (i + 1 === totalBundles) { // if last update, wait to get accurate bundle count from client
        await sleep(3000)
      }
      console.log('Saving progress checkpoint to data/log.json')
      const currentStatus = db.get('testReports').find({ id: id }).get('status').value()
      currentStatus.lastUpdated = parseInt(Date.now() / 1000) // ms to s
      currentStatus.bundlesSent = i + 1 // since it starts from 0
      currentStatus.bundlesReceived = await getBundlesInTxPool()
      currentStatus.successRate = (currentStatus.bundlesReceived / currentStatus.bundlesSent) * 100
      db.get('testReports').find({ id: id }).get('status').assign(currentStatus).write()
      console.log('Saved, current success rate: ' + currentStatus.successRate + '%')
    }
    await sleep(250) // 200 bundles per min, 1 bundle every 0.3s, assuming ~50ms to sign txs
  }
  const currentStatus = db.get('testReports').find({ id: id }).get('status').value()
  currentStatus.lastUpdated = parseInt(Date.now() / 1000) // ms to s
  currentStatus.completed = true
  db.get('testReports').find({ id: id }).get('status').assign(currentStatus).write()
  clearInterval(check)
  console.log('Test complete, final success rate %: ', currentStatus.successRate)
}
// Main function
const startTest = async (ws) => {
  console.log('Starting test')
  const id = initTestRun()
  console.log('Funding account.....')
  const tx = await faucet.sendTransaction({
    to: user.address,
    value: ethers.utils.parseEther('1')
  })
  await tx.wait()
  const balance = await simpleProvider.getBalance(user.address)
  console.log('Balance:', balance.toString())
  const totalBundles = testDurationInMins * bundlesPerMin
  console.log(`# of bundles to be sent in this test: ${totalBundles}`)
  console.log(`Test duration: ${testDurationInMins} mins`)
  const check = setInterval(async () => { // to log updates every 10s
    console.log('Total bundles received/in mev-geth tx pool: ')
    console.log(await getBundlesInTxPool())
  }, 10000)
  await sendBundles(totalBundles, ws, id, check)
}
