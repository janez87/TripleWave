/**
 * Module dependencies.
 */

var Enricher = require("./stream/enricher.js");
var Cache = require("./stream/cache.js");
var FromSPARQL = require('./stream/input_stream/fromSPARQL.js');
var Transformer = require('./stream/transformer.js');

var PropertiesReader = require('properties-reader');
var fs = require('fs');
var express = require('express');
var http = require('http');
var path = require('path');
var request = require('request');
var errorhandler = require('errorhandler');
var bodyParser = require('body-parser');
var async = require('async');
var SparqlClient = require('sparql-client-2');
var ps = require('ps-node');

var SPARQL = SparqlClient.SPARQL;

var app = express();

//var configuration = require('./config/config.json');
var configuration = PropertiesReader(path.resolve(__dirname, 'config', 'config.properties'));
var location = configuration.get('path');

// all environments
app.set('port', configuration.get('port'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//app.use(express.favicon());
//app.use(express.logger('dev'));
app.use(bodyParser.json());
//app.use(express.urlencoded());
//app.use(express.methodOverride());
//app.use(express.static(path.join(__dirname, 'public')));

// development only
var server = {

};


if (configuration.get('mode') === 'replay' || configuration.get('mode') === 'endless') {

  var WebSocketServer = require('ws').Server;
  var wss = new WebSocketServer({
    port: configuration.get('ws_port'),
    path: configuration.get('ws_stream_location')
  });

  wss.on('connection', function(ws) {

    console.log('Webscoket openeded');
    /*server.fromSPARQL.on('data', function(data) {
      console.log(data.toString());
      try {

        ws.send(data.toString());
      } catch (e) {
        console.log(e);

      }
    });*/

    var pushData = function(data) {
      var _this = this;
      try {
        ws.send(data.toString());
      } catch (e) {
        server.fromSPARQL.removeListener('data', pushData);

      }
    };

    ws.on('error', function(e) {
      console.log(e);
      ws.close();
    });

    try {

      server.fromSPARQL.on('data', pushData);
    } catch (e) {
      console.log(e);
    }

  });

  app.get(location + '/stream', function(req, res) {

    server.fromSPARQL.pipe(res);
    res.on('close', function() {
      server.fromSPARQL.unpipe(res);
    });

  });
}



if (configuration.get('mode') === 'transform') {

  var WebSocketServer = require('ws').Server;
  var wss = new WebSocketServer({
    port: configuration.get('ws_port'),
    path: configuration.get('ws_stream_location')
  });

  wss.on('connection', function(ws) {
    console.log('Webscoket openeded');
    /*server.enricher.on('data', function(data) {
      try {

        ws.send(data.toString());
      } catch (e) {
        console.log(e);

      }
    });*/

    var pushData = function(data) {
      var _this = this;
      try {
        ws.send(data.toString());
      } catch (e) {
        console.log(e);
        console.log('Closing the socket');
        server.enricher.removeListener('data', pushData);

      }
    };

    ws.on('error', function(e) {
      console.log('Error on the websocket');
      console.log(e);
      ws.close();
    });

    try {

      server.enricher.on('data', pushData);
    } catch (e) {
      console.log(e);
    }
  });

  app.get(location + '/stream', function(req, res) {

    console.log('Connection');

    server.enricher.pipe(res);

    res.on('close', function() {
      server.enricher.unpipe(res);
    });


  });



  if ('development' == app.get('env')) {
    app.use(errorhandler());
  }

}

app.get(location + '/sGraph', function(req, res) {
  return res.json(server.cache.getAll());
});

app.get(location + '/:ts', function(req, res) {
  console.log('Searching element with ts ' + req.params.ts);

  var element = server.cache.find(req.params.ts);

  if (element) {
    res.json({
      "@graph": element["@graph"]
    });
  } else {
    res.status = 404;
    res.json({
      error: "Element not found"
    });
  }
});


var loadFile = function(callback) {

  console.log('Loading the dataset file ' + configuration.get('rdf_file'));

  //'LOAD <file:../rdf/data.ttl> INTO GRAPH <http://example/input>'
  //var query = 'LOAD <file:..' + configuration.get('rdf_file') + '> INTO GRAPH <http://example/input>';

  var query = fs.readFileSync(path.resolve(__dirname, 'rdf', 'loadFile.q')).toString();

  query = query.split('[file]').join(configuration.get('rdf_file'));

  console.log(query);

  var options = {
    url: configuration.get('rdf_update_endpoint'),
    method: 'POST',
    form: {
      update: query
    },
    headers: {
      Accept: 'application/ld+json'
    }
  };

  return request.post(options, callback);

};


var transformInput = function(callback) {

  if (configuration.get('rdf_source') === 'rdfstream') {
    console.log('No need to transform the file');
    return callback();
  }

  var hostname = configuration.get('hostname');
  var port = configuration.get('port');
  var location = configuration.get('path');
  var graphName;

  if(configuration.get('externaladdress') != null && configuration.get('externaladdress').length > 0)
    graphName = 'http://' + configuration.get('externaladdress')
  else
    graphName = ('http://' + hostname + ':' + port + location);

  console.log(graphName);


  var create = fs.readFileSync(path.resolve(__dirname, 'rdf', 'createGraph.q')).toString();
  create = create.split('[hostname]').join(graphName);

  console.log(create);
  var options = {
    url: configuration.get('rdf_update_endpoint'),
    method: 'POST',
    form: {
      update: create
    },
    headers: {
      Accept: 'application/ld+json'
    }
  };

  request.post(options, function(error) {
    if (error) return callback(error);

    //var pattern = configuration.get('rdf_stream_item_pattern');
    var query = fs.readFileSync('./rdf/sGraphFillingQuery.q').toString();
    query = query.split('[graphname]').join(graphName);
    //query = query.split('[pattern]').join(pattern);

    console.log(query);
    options.form.update = query;

    return request.post(options, callback);
  });
};


var createNewGraphs = function(callback) {

  if (configuration.get('rdf_source') === 'rdfstream') {
    console.log('No need to transform the file');
    return callback();
  }
  var hostname = configuration.get('hostname');
  var port = configuration.get('port');
  var location = configuration.get('path');

  var graphName = configuration.get('externaladdress') || ('http://' + hostname + ':' + port + location);

  var query = fs.readFileSync(path.resolve(__dirname, 'rdf', 'selectGraphs.q')).toString();
  query = query.split('[hostname]').join(graphName);

  console.log('creating the new graph');
  console.log(query);
  var client = new SparqlClient(configuration.get('rdf_query_endpoint'));

  var createNewTriples = function(triple, cb) {
    console.log(triple);

    var graph = triple.graph.value;
    var key = triple.key.value;

    //var pattern = configuration.get('rdf_stream_item_content_pattern');
    //insertQuery = insertQuery.split('[pattern]').join(pattern);

    var insertQuery = fs.readFileSync('./rdf/timestampedGraphFillingQuery.q').toString();
    insertQuery = insertQuery.split('?key').join('<' + key + '>');
    insertQuery = insertQuery.split('[g]').join(graph);

    var create = 'CREATE GRAPH <' + graph + '>';
    console.log(create);
    console.log(insertQuery);
    var options = {
      url: configuration.get('rdf_update_endpoint'),
      method: 'POST',
      form: {
        update: create
      },
      headers: {
        Accept: 'application/ld+json'
      }
    };

    return request.post(options, function(err, res, b) {
      if (err) return cb(err);

      options.form.update = insertQuery;
      return request.post(options, function(error, response, body) {
        if (error) return cb(error);

        return cb();
      });

    });


  };

  client
    .query(query)
    .execute(function(err, data) {
      if (err) return console.log(err);

      var graphs = data.results.bindings;
      console.log(graphs);
      async.eachSeries(graphs, createNewTriples, function() {
        return callback();
      });
    });



};

app.listen(app.get('port'), function() {

  var argv = require('minimist')(process.argv.slice(2));


  if (configuration.get('mode') === 'transform') {
    console.log('Transform mode');
    console.log('Setting up the required streams');
    var Webstream = require(path.resolve('stream', 'input_stream', configuration.get('stream_name')));

    server.cache = new Cache({});
    server.enricher = new Enricher(server);
    server.activeStream = new Webstream();
    server.activeStream.pipe(server.enricher);
    server.enricher.pipe(server.cache);
    console.log(location);
    console.log('TripleWave listening on port ' + app.get('port'));

  } else {
    console.log('Loading the rdf dataset');
    var actions = [loadFile, transformInput, createNewGraphs];

    async.series(actions, function(err) {
      if (err) throw err;

      if (argv.f) {
        server.fuseki = argv.f;
        console.log('Starting TripleWave with Fuseki (pid: ' + server.fuseki + ' )');
      }

      server.cache = new Cache({});
      server.fromSPARQL = new FromSPARQL();
      server.fromSPARQL.pipe(server.cache);

      if (configuration.get('mode') === "endless") {

        var restartStream = function() {
          server.cache = new Cache({});
          server.fromSPARQL = new FromSPARQL();
          server.fromSPARQL.pipe(server.cache);
          server.fromSPARQL.on('end', restartStream);
        };
        server.fromSPARQL.on('end', restartStream);
      }
      console.log('TripleWave listening on port ' + app.get('port'));
    });

  }

});


process.on('beforeExit', function() {
  if (server.fuseki) {
    ps.kill(server.fuseki, function(err) {
      if (err) console.log(err);

      console.log('Fuseki killed :(');
    });
  }
});

process.on('exit', function() {
  if (server.fuseki) {
    ps.kill(server.fuseki, function(err) {
      if (err) console.log(err);

      console.log('Fuseki killed :(');
    });
  }
});