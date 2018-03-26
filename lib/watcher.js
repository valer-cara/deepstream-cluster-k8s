const events = require('events');
const domain = require('domain');
const ndjson = require('ndjson');
const retry = require('retry')
const log = require('log4js').getLogger();
const KubeClient = require('kubernetes-client').Client;
const KubeConfig = require('kubernetes-client').config;

class Watcher {
  constructor(clientConfig, namespace, { endpointName, endpointLabels }) {
    this.client = this._kubeClient(clientConfig);
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

  _kubeClient(clientConfig) {
    let cnf;
    if (clientConfig.kubeConfig) {
      if (clientConfig.kubeConfig !== true) {
        cnf = KubeConfig.loadKubeconfig(clientConfig.kubeConfig);
      }
      cnf = KubeConfig.fromKubeconfig();
    } else if (clientConfig.inCluster) {
      cnf = KubeConfig.getInCluster();
    } else {
      throw "Need to specify kube client config";
    }

    return new KubeClient({ config: cnf, version: '1.9' });
  }

  _startStream() {
    let operation = retry.operation({forever: true});
    let d = domain.create();

    let api = this.client.api.v1.watch.namespaces(this.namespace).endpoints;
    let streamOpts = {};

    if (this.endpointName) {
      api = api(this.endpointName);
    } else if (this.endpointLabels) {
      streamOpts = { qs: { labelSelector: this.endpointLabels }}
    } else {
      throw "Must provide name or labels for endpoint to watch."
    }

    // Isolate the API connection in a domain to catch connection errors
    d.on('error', (e) => this._retry(operation, e));

    operation.attempt((currentAttempt) => {
      this.endpointStream.emit('attempt', currentAttempt);

      d.run(() => {
        log.debug("Connecting to Kubernetes api...")
        const stream = api.getStream(streamOpts).pipe(ndjson.parse());

        stream.on('data', (ep) => {
          if (ep["kind"] == "Status") {
            log.warn(ep["status"], ep["message"]);
          } else if (ep["object"]) {
            this.endpointStream.emit('update', this._parseEndpoint(ep))
          } else {
            throw("Cannot decode reponse", ep.toString());
          }
        });

        stream.on('end', () => this._retry(operation, new Error("Stream ended")));
        stream.on('error', (e) => this._retry(operation, new Error(e)));
      });
    });
  }

  _retry(operation, err) {
    log.warn("Retrying.", String(operation.mainError()));
    operation.retry(err);
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

