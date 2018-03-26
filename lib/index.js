const argv = require('yargs').argv;
const log = require('log4js').getLogger();
const Deepstream = require('deepstream.io-cluster');
const Watcher = require('./watcher')

log.level = 'debug';

const server = new Deepstream({
  cluster: {
    bindAddress: {
      host: argv.ip
    }
  }
});

const endpointWatcher = new Watcher(
  getKubeClientConfig(),
  argv.namespace || 'default',
  { endpointName: argv.name,
    endpointLabels: argv.labels }
).watchEndpoint();

endpointWatcher.on('update', (endpoints) => reconcilePeers(server, endpoints));
endpointWatcher.on('attempt', (attempts) => log.info("Attempt", attempts));

server.on('started', function() {
  console.log("Server started! Host:", argv.ip);
});

server.start();

function reconcilePeers(server, endpoints) {
  log.debug("Updating endpoints ----------");
  log.debug("endpoints", endpoints);
  log.debug("peers before:", server.getPeers());

  const peers = server.getPeers();
  endpoints.forEach((ep) => {
    const peer = peers.find((p) => p["host"] === ep["host"]);
    if (!peer) {
      log.info("Adding peer", ep["host"]);
      server.addPeer({ host: ep["host"] });
    }
  });

  peers.forEach((peer) => {
    const ep = endpoints.find((e) => e["host"] === peer["host"]);
    if (!ep) {
      log.info("Removing stale peer", peer["host"]);
      server.removePeer(peer);
    }
  });

  log.debug("peers after:", server.getPeers());
  log.debug("Done ----------");
}

function getKubeClientConfig() {
  if (argv.kubeconfig) {
    return { kubeConfig: argv.kubeconfig }
  } else {
    return { inCluster: true }
  }
}

