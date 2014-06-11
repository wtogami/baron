var config = require(__dirname + '/../config');
var invoiceWebhooks = require(__dirname + '/../invoicewebhooks');
var db = require(__dirname + '/../db');
var async = require('async');

function webhooksJob(cb) {
  db.getWebhooks(function (err, webhooksArr) {
    if (!err && webhooksArr) {
      console.log('===========================');
      console.log('Retrying Failed Webhooks [' + webhooksArr.length + ']');
      console.log('===========================');
      async.eachSeries(webhooksArr, function(webhookObj, cb) {
        invoiceWebhooks.postToWebhookIgnoreFailure(webhookObj, cb);
      }, function(err) {
        if (!err) {
          console.log('> Done processing failed webhooks.');
        }
      });
      cb();
    }
  });
}

var runWebhooksJob = function () {
  // Periodically retry previously failed webhooks
  async.whilst(
    function() { return true; },
    function(cb) {
      setTimeout(webhooksJob, config.webhooksJobInterval, cb);
    },
    function(err) {
      console.log(err);
    }
  );
}

module.exports = {
  runWebhooksJob: runWebhooksJob
};
