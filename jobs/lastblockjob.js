var config = require(__dirname + '/../config');
var validate = require(__dirname + '/../validate');
var bitcoinUtil = require(__dirname + '/../bitcoinutil');
var paymentUtil = require(__dirname + '/../paymentutil');
var db = require(__dirname + '/../db');
var async = require('async');

// Stores initial "last block hash" if it doesnt exist returns it if it does
function getLastBlockHash(cb) {
  db.getLastKnownBlockHash(function(err, lastBlockHash) {
    if (err) {
      return cb(err, null);
    }
    if (lastBlockHash) {
      return cb(null, lastBlockHash);
    }
    else {
      bitcoinUtil.getBestBlockHash(function (err, lastBlockHash) {
        if (err) {
          return cb(err, null);
        }
        lastBlockHash.hash = lastBlockHash.result;
        lastBlockHash.type = 'blockhash';
        delete lastBlockHash.id;
        delete lastBlockHash.error;
        delete lastBlockHash.result;
        db.insert(lastBlockHash, function(err) {
          if (err) {
            return cb(err, null);
          }
          return cb(null, lastBlockHash);
        });
      });
    }
  });
}

function processBlockHash(blockHashObj, cb) {
  var blockHash = blockHashObj.hash;
  bitcoinUtil.getBlock(blockHash, function(err, block) {
    if (err) {
      if (block.error.code === -5) {
        console.log('Fatal Error: Blockhash ' + blockHash + ' is not known to bitcoind.  This should never happen.  Delete lastBlockHash from baron db if you wish to proceed.');
        process.exit(1);
      }
      console.log(err);
      return cb();
    }
    block = block.result;
    //console.log('> Block Valid: ' + validate.block(block));
    // Get List Since Block 
    bitcoinUtil.listSinceBlock(blockHash, function (err, info) {
      if (err) {
        console.log(err);
        return cb();
      }
      info = info.result;
      var transactions = [];
      info.transactions.forEach(function(transaction) {
        if (transaction.category === 'receive') { // ignore sent tx's
          transactions.push(transaction);
        }
      });
      var lastBlockHash = info.lastblock;
      // If valid get transactions since last block (bitcore)
      if (validate.block(block)) {
        async.eachSeries(transactions, function(transaction, cb2) {
          paymentUtil.updatePayment(transaction, cb2);
        }, function(err) {
          if (!err) {
            if (blockHash !== lastBlockHash) {
              blockHashObj.hash = lastBlockHash; // update to latest block
              db.insert(blockHashObj); // insert updated last block into db
            }
          }
          cb();
        });
      }
      else { // If invalid update all transactions in block and step back
        transactions.forEach(function(transaction) {
          paymentUtil.processReorgAndCheckDoubleSpent(transaction, block.hash);
        }); // For each should block until complete
        paymentUtil.processReorgedPayments(block.hash);
        // Update reorged transactions (set block_hash = null)
        console.log('> REORG: Recursively processing previous block: ' + block.previousblockhash);
        // Recursively check previousHash
        blockHashObj.hash = block.previousblockhash;
        processBlockHash(blockHashObj, cb);
    }
    });
  });
}

var lastBlockJob = function(cb) {
  // Get Last Block, create it if baron isnt aware of one.
  getLastBlockHash(function(err, lastBlockHashObj) {
    if (err) {
      return console.log(err);
    }
    else if (!lastBlockHashObj.hash) {
      return console.log('Last block object missing hash, check Baron\'s database');
    }
    console.log('===========================');
    console.log('Processing Last Block: ' + lastBlockHashObj.hash);
    console.log('===========================');
    processBlockHash(lastBlockHashObj, cb);
  });
};

var blockQueue = async.queue(function (fn, cb) {
  fn(cb);
}, 1);

blockQueue.drain = function() {
  console.log('blockQueue: empty');
}

var runLastBlockJob = function () {
  // Periodically process new block
  async.whilst(
    function() { return true; },
    function(cb) {
      setTimeout(lastBlockJob, config.lastBlockJobInterval, cb);
    },
    function(err) {
      console.log(err);
    }
  );
}

module.exports = {
  runLastBlockJob: runLastBlockJob,
  lastBlockJob: lastBlockJob,
};
