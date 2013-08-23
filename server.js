var sx = require('./sxlib.js'),
    electrum_wallet = require('./wallet.js'),
    Db = require('mongodb').Db,
    Connection = require('mongodb').Connection,
    Server = require('mongodb').Server,
    BSON = require('mongodb').BSON,
    ObjectID = require('mongodb').ObjectID,
    express = require('express'),
    crypto = require('crypto'),
    sha256 = function(x) { return crypto.createHash('sha256').update(x).digest('hex') },
    eh = sx.eh;

module.exports = function() {

    var host = process.env['MONGO_NODE_DRIVER_HOST'] != null ? process.env['MONGO_NODE_DRIVER_HOST'] : 'localhost';
    var port = process.env['MONGO_NODE_DRIVER_PORT'] != null ? process.env['MONGO_NODE_DRIVER_PORT'] : Connection.DEFAULT_PORT;

    var db = new Db('nodesx-wal', new Server(host, port), {safe: false}, {auto_reconnect: true}, {});

    var Wallet;
    db.open(function(err,dbb) {
        db = dbb;
        db.collection('wallet',function(err,collection) { 
            if (err) { throw err; }
            Wallet = collection;
        }); 
    });

    var app = express();

    app.configure(function(){                                                                 
         app.set('views',__dirname + '/views');                                                  
         app.set('view engine', 'jade'); app.set('view options', { layout: false });             
         app.use(express.bodyParser());                                                          
         app.use(express.methodOverride());                                                      
         app.use(app.router);                                                                    
         app.use(express.static(__dirname + '/public'));                                         
    });

    var active_wallets = {};

    var mkrespcb = function(res,code,success) {
        return eh(function(e) { res.json(e,code); },success);
    }

    var retrieve = function(name,pw,cb) {
        if (active_wallets[name]) { 
            if (pw == active_wallets[name].pw) {
                 return cb(null,active_wallets[name]);
            }
            else { return cb("Bad password"); }
        }       
        Wallet.findOne({ name: name },eh(cb,function(w) {
            if (w) {
                if (pw == w.pw) { 
                    electrum_wallet(w,null,eh(cb,function(w2) {
                        cb(null,w2); 
                    }));
                }
                else { cb("Bad password"); }
            }
            else { cb(null,null); }
        }));
    }

    var hard_retrieve = function(req,cb) {
        var name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));
        retrieve(name,pw,eh(cb,function(w) { w ? cb(null,w) : cb("No wallet") }));
    }

    var finalize_wallet = function(w) {
        active_wallets[w.name] = w;
        w.update = function() {
            console.log("Updating wallet...");
            Wallet.update({name: w.name},w,function(){});
        }
    }
    
    app.get('/get',function(req,res) {
        var seed = sha256(""+req.param("name")+":"+req.param("pw")).substring(0,32),
            name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));

        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (w) {
                finalize_wallet(w);
                if (req.param('reload')) {
                    console.log('Force reloading');
                    w.reload(mkrespcb(res,400,function(w) { return res.json(w); }));
                }
                else return res.json(w); 
            }
            else electrum_wallet(seed,null,mkrespcb(res,400,function(w) {
                w.name = name;
                w.pw = pw;
                Wallet.insert(w,mkrespcb(res,400,function(w2) {
                    finalize_wallet(w);
                    console.log("Finished loading: ",w);
                    res.json(w);
                }));
            }));
        }));
    });
    app.get('/addr',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            w.getaddress(mkrespcb(res,400,function(addr) {
                return res.json(addr);
            }));
        }));
    });
    app.get('/reset',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            delete active_wallets[w.name];
            electrum_wallet({
                seed: w.seed,
                name: w.name,
                pw: w.pw,
                n: w.n,
                special: w.special
            },null,mkrespcb(res,400,function(w2) {
                finalize_wallet(w2);
                res.json(w2);
            }));
        }));
    });
    var send = function(req,res) {
        var name = ""+req.param("name"),
            pw = sha256(req.param("pw")),
            to = req.param("to"),
            value = parseInt(req.param("value"));
        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (!w) { 
                return res.json("Wallet not found"); 
            }
            console.log(1);
            w.send(to,value,mkrespcb(res,400,function(tx) {
                console.log(3);
                return res.json(tx);
            }));
        }));
    }
    app.get('/send',send);
    app.post('/send',send);

    app.get('/',function(req,res) {                                                           
        res.render('main.jade',{});                                                           
    });
    app.listen(3191);

    return app;
};

