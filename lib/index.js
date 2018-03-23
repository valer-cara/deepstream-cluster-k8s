const Deepstream = require('deepstream.io-cluster');
const Watcher = require('./watcher')
const log = require('log4js').getLogger();
log.level = 'debug';

const server = new Deepstream();

const w = new Watcher('default', { endpointLabels: 'release=fe' });
const endpointWatcher = w.watchEndpoint();

endpointWatcher.on('update', (endpoints) => {
  reconcilePeers(server, endpoints)
});
endpointWatcher.on('attempt', (attempts) => log.info("Attempt", attempts));

server.on('started', function() {
  console.log("Server started!");
});

server.start();

function reconcilePeers(server, endpoints) {
  log.debug("Updated endpoints", endpoints);
  console.log("peers", server.getPeers());
  console.log("endpoits", endpoints);
}

