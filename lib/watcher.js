const events = require('events');
const domain = require('domain');
const ndjson = require('ndjson');
const log = require('log4js').getLogger();
const KubeClient = require('kubernetes-client').Client;
const KubeConfig = require('kubernetes-client').config;

const retry = require('retry')

RETRY_LIMIT = 30000;
RETRY_BACKOFF = 1.5;

log.level = 'debug';

class Watcher {
  constructor(namespace, { endpointName, endpointLabels }) {
    this.client = new KubeClient({ config: KubeConfig.fromKubeconfig(), version: '1.9' });
    this.endpointStream = new events.EventEmitter();

    this.namespace = namespace;
    this.endpointName = endpointName;
    this.endpointLabels = endpointLabels;

    this.retryInterval = 10000;
  }

  watchEndpoint() {
    this._startStream();
    return this.endpointStream;
  }

  _startStream() {
    let operation = retry.operation({forever: true});
    let d = domain.create();

    let api = this.client.api.v1.watch.namespaces(this.namespace).endpoints;
    let streamOpts = {};

    if (this.endpointName) {
      api = api('fe-dashboard');
    } else if (this.endpointLabels) {
      streamOpts = { qs: { labelSelector: this.endpointLabels }}
    } else {
      throw "Must provide name or labels for endpoint to watch."
    }

    // Isolate the API connection in a domain to catch connection errors
    d.on('error', (e) => operation.retry(e));

    operation.attempt((currentAttempt) => {
      this.endpointStream.emit('attempt', currentAttempt);

      d.run(() => {
        log.debug("Connecting to Kubernetes api...")
        const stream = api.getStream(streamOpts).pipe(ndjson.parse());

        stream.on('data', (ep) => {
          this.endpointStream.emit('update', this._parseEndpoint(ep))
        });

        stream.on('end', () => operation.retry(new Error("Stream ended")));
        stream.on('error', (e) => operation.retry(new Error(e)));
      });
    });
  }

  _parseEndpoint(ep) {
    return ep["object"]["subsets"].reduce(function(acc, subset) {
      subset["ports"].forEach(function(port) {
        subset["addresses"].forEach(function(addr) {
          acc.push({
            host: addr["ip"],
            port: port["port"]
          })
        })
      });
      return acc;
    }, []);
  }
}

module.exports = Watcher;

