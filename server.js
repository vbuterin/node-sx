var sx = require('./sxlib.js'),
    electrum_wallet = require('./wallet.js'),
    eto = require('./eto.js');
    Db = require('mongodb').Db,
    Connection = require('mongodb').Connection,
    Server = require('mongodb').Server,
    BSON = require('mongodb').BSON,
    ObjectID = require('mongodb').ObjectID,
    express = require('express'),
    crypto = require('crypto'),
    async = require('async'),
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

    var update_int = setInterval(function() {
        for (var v in active_wallets) {
            var w = active_wallets[v];
            w.update_history(function() {
                //console.log("Saving wallet...");
                Wallet.update({name: w.name},w,function(){});
            });
        }
    },15000);

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

    app.get('/get',function(req,res) {
        var seed = sha256(""+req.param("name")+":"+req.param("pw")).substring(0,32),
            name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));

        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (w) {
                active_wallets[w.name] = w;
                if (req.param('reload')) {
                    console.log('Force reloading');
                    w.update_history(mkrespcb(res,400,function() {
                        console.log("Finished loading: ",w);
                        return res.json(w); 
                    }));
                }
                else return res.json(w); 
            }
            else electrum_wallet(seed,null,mkrespcb(res,400,function(w) {
                w.name = name;
                w.pw = pw;
                Wallet.insert(w,mkrespcb(res,400,function(w2) {
                    active_wallets[w.name] = w;
                    console.log("Finished loading: ",w);
                    res.json(w);
                }));
            }));
        }));
    });
    app.get('/addr',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            w.getaddress(mkrespcb(res,400,function(address) {
                return res.json(address);
            }));
        }));
    });
    app.get('/reset',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            Wallet.remove({ name: w.name },mkrespcb(res,400,function() {
                delete active_wallets[w.name];
                electrum_wallet({
                    seed: w.seed,
                    name: w.name,
                    pw: w.pw,
                    n: w.n,
                    special: w.special
                },null,mkrespcb(res,400,function(w2) {
                    active_wallets[w.name] = w2;
                    res.json(w2);
                }));
            }));
        }));
    });
    var send = function(req,res) {
        var name = ""+req.param("name"),
            pw = sha256(req.param("pw")),
            to = req.param("to"),
            value = Math.ceil(parseFloat(req.param("value"))*100000000);
        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (!w) { 
                return res.json("Wallet not found"); 
            }
            w.send(to,value,mkrespcb(res,400,function(tx) {
                return res.json(tx);
            }));
        }));
    }
    app.get('/send',send);
    app.post('/send',send);

    app.get('/msigaddr',function(req,res) {
        var pubs = [];
        for (var v in req.query) {
            if (v.substring(0,3) == "pub") {
                if (req.query[v].length == 66 || req.query[v].length == 130) {
                    pubs.push(req.query[v]); 
                }
                else if (req.query[v]) { return res.json("Bad pubkey: "+req.query[v]); }
            }
        }
        var k = parseInt(req.param("k"));
        if (isNaN(k)) {
            return res.json("Invalid k: "+k,400); 
        }
        console.log("Generating multisig address from "+k+" of: ",pubs)
        sx.gen_multisig_addr_data(pubs,k,mkrespcb(res,400,function(d) {
            res.json(d);
        }));
    });

    app.get('/mkmultitx',function(req,res) {
        var from   = req.param('from'),
            to     = req.param('to'),
            script = req.param('script'),
            value  = Math.ceil(parseFloat(req.param('value')) * 100000000);
        async.waterfall([function(cb2) {
            if (from.length > 34) {
                sx.fetch_transaction(utxoid.substring(0,64),eh(cb2,function(tx) {
                    sx.showtx(tx,eh(cb2,function(shown) {
                        return cb2(null,[shown.outputs[parseInt(utxoid.substring(65))]]);
                    }));
                }));
            }
            else if (from) {
                sx.get_utxo(from,value+10000,cb2);
            }
            else { return cb2("Need from or utxo"); }
        }, function(utxo,cb2) {
            console.log("Making transaction sending "+value+" satoshis to "+to);
            console.log("UTXO:",utxo);
            sx.make_sending_transaction(utxo,to,value,utxo[0].address,eh(cb2,function(tx) {
                cb2(null,tx,utxo);
            }));
        }, function(tx,utxo,cb2) {
            var scriptmap = {};
            scriptmap[utxo[0].address] = script;
            eto.mketo(tx,scriptmap,utxo,cb2);
        }],mkrespcb(res,400,function(eto_object) {
            res.json(eto_object);
        }));
    });

    app.get('/signeto',function(req,res) {
        try {
            var eto_object = JSON.parse(req.param('eto')),
                pk = req.param('privkey');
        }
        catch(e) { 
            return res.json("Failed to JSON parse: ",req.param("eto")); 
        }
        eto.signeto(eto_object,pk,mkrespcb(res,400,function(eto_object) { res.json(eto_object); }));
    });

    app.get('/applysigtoeto',function(req,res) {
        try {
            var eto_object = JSON.parse(req.param('eto')),
                sig = req.param('sig');
        }
        catch(e) { 
            return res.json("Failed to JSON parse: ",req.param("eto")); 
        }
        eto.apply_sig_to_eto(eto_object,sig,mkrespcb(res,400,function(eto_object) {
            res.json(eto_object);
        }));
    });
    
    app.get('/pusheto',function(req,res) {
        try {
            var eto_object = JSON.parse(req.param('eto'));
        }
        catch(e) { 
            return res.json("Failed to JSON parse: ",req.param("eto")); 
        }
        eto.publish_eto(eto_object,mkrespcb(res,400,function(msg) { res.json(msg); }));
    });

    app.get('/wallet',function(req,res) {                                                           
        res.render('wallet.jade',{});                                                           
    });

    app.get('/multigui',function(req,res) {                                                           
        res.render('multigui.jade',{});                                                           
    });

    app.listen(3191);

    return app;
};

