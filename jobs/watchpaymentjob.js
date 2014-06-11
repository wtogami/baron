var config = require(__dirname + '/../config');
var helper = require(__dirname + '/../helper');
var db = require(__dirname + '/../db');
var paymentUtil = require(__dirname + '/../paymentutil');
var bitcoinUtil = require(__dirname + '/../bitcoinutil');
var async = require('async');

// TODO: This job can be removed in the future, we can calculate
// The confirmations of our watched payments based on our stored
// last known block. Remove in the future.

function updateWatchedPayment(payment, transaction, cb) {
  var receiveDetail = helper.getReceiveDetail(transaction.details);
  if (receiveDetail || (!receiveDetail && (transaction.confirmations === -1))) {
    transaction.address = receiveDetail ? receiveDetail.address : payment.address;
    transaction.amount = receiveDetail ? receiveDetail.amount : payment.amount_paid;
    paymentUtil.updatePaymentWithTransaction(payment, transaction, function(err) {
      if (err) {
        console.log(err);
      }
      cb();
    });
  }
}

function checkPaymentExpiration(payment, cb) {
    var curTime = new Date().getTime();
    var expirationTime = Number(payment.created) + config.paymentValidForMinutes * 60 * 1000;
    if(payment.status === 'unpaid' && expirationTime < curTime) {
      payment.watched = false;
      db.insert(payment);
    }
    cb();
}

var watchPaymentsJob = function (cb) {
  db.getWatchedPayments(function (err, paymentsArr) {
    if (err) {
      console.log(err);
      return cb();
    }
    else if (!paymentsArr) {
      return cb();
    }
    // Process all watched payments
    console.log('===========================');
    console.log('Watch Payments Job: ' + paymentsArr.length);
    console.log('===========================');
    var paidCount = 0;
    var unpaidCount = 0;
    paymentsArr.forEach(function(payment) {
      if (payment.tx_id) { // payment received, now watching
        paidCount++;

        bitcoinUtil.getTransaction(payment.tx_id, function (err, transaction) {
          if (err) {
            console.log(err);
          }
          else {
            updateWatchedPayment(payment, transaction.result, cb);
          }
        });
      }
      else { // payment not received
        unpaidCount++;
        checkPaymentExpiration(payment, cb);
      }
    });
    console.log('> Watched Paid Count: ' + paidCount);
    console.log('> Watched Unpaid Count: ' + unpaidCount);
    cb();
  });
};

var runWatchPaymentsJob = function () {
  // Periodically update confirmations on all watched transactions
  async.whilst(
    function() { return true; },
    function(cb) {
      setTimeout(watchPaymentsJob, config.updateWatchListInterval, cb);
    },
    function(err) {
      console.log(err);
    }
  );
}

module.exports = {
  runWatchPaymentsJob:runWatchPaymentsJob,
  watchPaymentsJob: watchPaymentsJob
};
