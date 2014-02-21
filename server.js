var sx              = require('./main'),
    express         = require('express'),
    Db              = require('mongodb').Db,
    Connection      = require('mongodb').Connection,
    Server          = require('mongodb').Server,
    BSON            = require('mongodb').BSON,
    ObjectID        = require('mongodb').ObjectID;

var app = express();                                                                      
                                                                                          
app.configure(function() {                                                                
     app.set('views',__dirname + '/views');                                               
     app.set('view engine', 'jade'); app.set('view options', { layout: false });          
     app.use(express.bodyParser());                                                       
     app.use(express.methodOverride());                                                     
     //app.use(allowCrossDomain);
     app.use(app.router);                                                                 
     app.use(express.static(__dirname + '/public'));                                      
});

var mkrespcb = function(res, code, cb) {
    return sx.eh(function(r) { res.json(r,code) }, cb)
}

var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', "*");
    //res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    //res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
}

var host = process.env['MONGO_NODE_DRIVER_HOST'] != null 
        ? process.env['MONGO_NODE_DRIVER_HOST'] 
        : 'localhost';
var port = process.env['MONGO_NODE_DRIVER_PORT'] != null 
        ? process.env['MONGO_NODE_DRIVER_PORT'] 
        : Connection.DEFAULT_PORT;

var db = new Db('nodesx', new Server(host, port), {safe: false}, {auto_reconnect: true}, {});

// Simulate empty database if real DB is unavailable
var txdb = {
    findOne: function(a,cb) { cb() },
    insert: function(a,cb) { cb() } 
}

// Open DB
db.open(sx.eh(function(e){ console.log(e) },function(dbb) {
    db = dbb;
    db.collection('txdb',function(err,collection) { 
        if (err) { throw err; }
        txdb = collection;
    });
}));

app.post('/pushtx',function(req,res) {
    res.header('Access-Control-Allow-Origin', "*");
    var tx = '';
    for (var p in req.body) tx = p;
    sx.bci_pushtx(tx,mkrespcb(res,400,function(r) { res.json(r) }))
});

app.get('/history/:address',function(req,res,next) {
    console.log(req.param('address'))
    res.header('Access-Control-Allow-Origin', "*");
    sx.history(req.param('address'),mkrespcb(res,400,function(r) { res.json(r) }))
});

app.get('/fetchtx/:txid',function(req,res,next) {
    res.header('Access-Control-Allow-Origin', "*");
    txdb.findOne({ txid: req.param('txid') },mkrespcb(res,400,function(r) {
        if (r) { res.json(r.tx) }
        else {
            sx.fetch_transaction(req.param('txid'),mkrespcb(res,400,function(tx) {
                txdb.insert({ txid: req.param('txid'), tx: tx },mkrespcb(res,400,function() {
                     res.json(tx);
                }))
            }))
        }
    }))
});

app.listen(3001);

return app;
